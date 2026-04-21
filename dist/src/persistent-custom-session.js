/**
 * Persistent Custom Session — generic wrapper for any coding agent CLI
 *
 * Supports two operating modes based on CustomEngineConfig.persistent:
 *
 *   persistent=true  — long-running subprocess with stream-json I/O over
 *                       stdin/stdout (like Claude Code). Started once, messages
 *                       sent as JSON lines on stdin.
 *
 *   persistent=false — one-shot per send (like Gemini/Codex). Each send()
 *                      spawns a new process with the message as a CLI argument.
 *
 * The config maps OpenClaw session concepts (permission modes, models, etc.)
 * to the target CLI's flags, so any coding agent with a CLI can be integrated
 * without writing engine-specific code.
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getModelPricing as _getModelPricingBase, } from './types.js';
import { resolveAlias, estimateTokens } from './models.js';
import { CONTEXT_HIGH_THRESHOLD, MAX_HISTORY_ITEMS, DEFAULT_HISTORY_LIMIT, SESSION_READY_TIMEOUT_MS, SESSION_READY_FALLBACK_MS, TURN_TIMEOUT_MS, COMPACT_TIMEOUT_MS, STOP_SIGKILL_DELAY_MS, SESSION_EVENT, } from './constants.js';
// ─── Helpers ────────────────────────────────────────────────────────────────
function getModelPricing(model, engineConfig) {
    // Try the model registry first; fall back to engine-level pricing
    const base = _getModelPricingBase(model, 'claude-sonnet-4-6');
    if (base.input === 0 && base.output === 0 && engineConfig.pricing) {
        return engineConfig.pricing;
    }
    return base;
}
function resolveBin(engineConfig) {
    if (engineConfig.binEnv) {
        const envVal = process.env[engineConfig.binEnv];
        if (envVal)
            return envVal;
    }
    return engineConfig.bin;
}
/** Build sanitizer function from config patterns + common defaults */
function buildSanitizer(engineConfig) {
    const patterns = [
        // Always sanitize Bearer tokens and common API key patterns
        { re: /Bearer [a-zA-Z0-9_-]+/g, replacement: 'Bearer ***' },
        { re: /sk-[a-zA-Z0-9_-]{10,}/g, replacement: 'sk-***' },
    ];
    if (engineConfig.sanitizePatterns) {
        for (const p of engineConfig.sanitizePatterns) {
            try {
                patterns.push({ re: new RegExp(p, 'g'), replacement: '***' });
            }
            catch {
                // Invalid regex — skip silently
            }
        }
    }
    return (text) => {
        let result = text;
        for (const { re, replacement } of patterns) {
            re.lastIndex = 0;
            result = result.replace(re, replacement);
        }
        return result;
    };
}
// ─── PersistentCustomSession ───────────────────────────────────────────────
export class PersistentCustomSession extends EventEmitter {
    options;
    engineConfig;
    engineBin;
    sanitize;
    // Persistent mode state
    proc = null;
    _rl = null;
    _streamCallbacks = null;
    _contextHighFired = false;
    // One-shot mode state
    currentProc = null;
    _currentRl = null;
    // Shared state
    _isReady = false;
    _isPaused = false;
    _isBusy = false;
    currentRequestId = 0;
    _startTime = null;
    _history = [];
    sessionId;
    _stats = {
        turns: 0,
        toolCalls: 0,
        toolErrors: 0,
        tokensIn: 0,
        tokensOut: 0,
        cachedTokens: 0,
        costUsd: 0,
        lastActivity: null,
    };
    constructor(config) {
        super();
        if (!config.customEngine) {
            throw new Error('CustomEngineConfig is required for custom engine sessions');
        }
        this.engineConfig = config.customEngine;
        this.engineBin = resolveBin(this.engineConfig);
        this.sanitize = buildSanitizer(this.engineConfig);
        this.options = {
            ...config,
            permissionMode: config.permissionMode || 'acceptEdits',
        };
    }
    get pid() {
        return this.proc?.pid ?? this.currentProc?.pid ?? undefined;
    }
    get isReady() {
        return this._isReady;
    }
    get isPaused() {
        return this._isPaused;
    }
    get isBusy() {
        return this._isBusy;
    }
    // ─── Start ───────────────────────────────────────────────────────────────
    async start() {
        // Normalize CWD
        if (this.options.cwd) {
            this.options.cwd = path.resolve(this.options.cwd);
            if (!fs.existsSync(this.options.cwd)) {
                fs.mkdirSync(this.options.cwd, { recursive: true });
            }
        }
        if (this.engineConfig.persistent) {
            return this._startPersistent();
        }
        else {
            return this._startOneShot();
        }
    }
    // ── Persistent mode start ───────────────────────────────────────────────
    async _startPersistent() {
        const a = this.engineConfig.args;
        const args = [];
        // Print mode
        if (a.print)
            args.push(a.print);
        // I/O format
        if (a.inputFormat && a.inputFormatValue)
            args.push(a.inputFormat, a.inputFormatValue);
        if (a.outputFormat && a.outputFormatValue)
            args.push(a.outputFormat, a.outputFormatValue);
        // Streaming flags
        if (a.replayUserMessages)
            args.push(a.replayUserMessages);
        if (a.verbose)
            args.push(a.verbose);
        if (a.includePartialMessages)
            args.push(a.includePartialMessages);
        // Permission mode
        this._appendPermissionArgs(args);
        // Model
        if (this.options.model && a.model) {
            args.push(a.model, this.options.model);
        }
        // Resume
        if (this.options.resumeSessionId && a.resume) {
            args.push(a.resume, this.options.resumeSessionId);
        }
        // System prompts
        if (this.options.systemPrompt && a.systemPrompt) {
            args.push(a.systemPrompt, this.options.systemPrompt);
        }
        if (this.options.appendSystemPrompt && a.appendSystemPrompt) {
            args.push(a.appendSystemPrompt, this.options.appendSystemPrompt);
        }
        // Limits
        if (this.options.maxTurns && a.maxTurns) {
            args.push(a.maxTurns, String(this.options.maxTurns));
        }
        // Skip permissions
        if (this.options.dangerouslySkipPermissions && a.skipPermissions) {
            args.push(a.skipPermissions);
        }
        // Effort
        if (this.options.effort && this.options.effort !== 'auto' && a.effort) {
            args.push(a.effort, this.options.effort);
        }
        // Extra static args
        if (a.extra?.length)
            args.push(...a.extra);
        // Spawn environment
        const spawnEnv = {
            ...process.env,
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
            ...this.engineConfig.env,
        };
        this.proc = spawn(this.engineBin, args, {
            cwd: this.options.cwd,
            env: spawnEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: true,
        });
        this.proc.unref();
        // Parse stdout line-by-line
        this._rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
        this._rl.on('line', (line) => {
            if (!line.trim())
                return;
            try {
                const event = JSON.parse(line);
                this._handlePersistentEvent(event);
            }
            catch {
                this.emit(SESSION_EVENT.LOG, `[${this.engineConfig.name}-stdout] ${line}`);
            }
        });
        this.proc.stderr?.on('data', (data) => {
            this.emit(SESSION_EVENT.LOG, `[${this.engineConfig.name}-stderr] ${this.sanitize(data.toString())}`);
        });
        this.proc.on('close', (code) => {
            this._isReady = false;
            this.emit(SESSION_EVENT.CLOSE, code);
        });
        this.proc.on('error', (err) => {
            this.emit(SESSION_EVENT.ERROR, err);
        });
        // Wait for ready
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${this.engineConfig.name} session ready`)), SESSION_READY_TIMEOUT_MS);
            this.once(SESSION_EVENT.READY, () => {
                clearTimeout(timeout);
                resolve(this);
            });
            this.once(SESSION_EVENT.ERROR, (err) => {
                clearTimeout(timeout);
                reject(err);
            });
            const onCloseBeforeReady = (code) => {
                if (!this._isReady) {
                    clearTimeout(timeout);
                    reject(new Error(`${this.engineConfig.name} process exited prematurely with code ${code}. Session failed to start.`));
                }
            };
            this.once(SESSION_EVENT.CLOSE, onCloseBeforeReady);
            const onInit = () => {
                if (!this._isReady) {
                    this._isReady = true;
                    this.removeListener(SESSION_EVENT.CLOSE, onCloseBeforeReady);
                    this.emit(SESSION_EVENT.READY);
                }
            };
            this.once(SESSION_EVENT.INIT, onInit);
            // Fallback: mark ready after 2s if no init event
            setTimeout(() => {
                this.removeListener(SESSION_EVENT.INIT, onInit);
                if (this.proc?.killed || this.proc?.exitCode !== null) {
                    clearTimeout(timeout);
                    this.removeListener(SESSION_EVENT.CLOSE, onCloseBeforeReady);
                    reject(new Error(`${this.engineConfig.name} CLI crashed on startup. Fallback timer aborted.`));
                    return;
                }
                if (!this._isReady) {
                    this._isReady = true;
                    this.removeListener(SESSION_EVENT.CLOSE, onCloseBeforeReady);
                    this.emit(SESSION_EVENT.READY);
                }
            }, SESSION_READY_FALLBACK_MS);
        });
    }
    // ── One-shot mode start ─────────────────────────────────────────────────
    async _startOneShot() {
        const eName = this.engineConfig.name;
        this.sessionId = `${eName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this._startTime = new Date().toISOString();
        this._isReady = true;
        this.emit(SESSION_EVENT.READY);
        this.emit(SESSION_EVENT.INIT, { type: 'system', subtype: 'init', session_id: this.sessionId });
        return this;
    }
    // ─── Send ────────────────────────────────────────────────────────────────
    async send(message, options = {}) {
        if (!this._isReady)
            throw new Error('Session not ready. Call start() first.');
        if (this.engineConfig.persistent) {
            return this._sendPersistent(message, options);
        }
        else {
            return this._sendOneShot(message, options);
        }
    }
    // ── Persistent mode send ────────────────────────────────────────────────
    async _sendPersistent(message, options) {
        if (!this.proc)
            throw new Error('Session not ready. Call start() first.');
        const requestId = ++this.currentRequestId;
        let finalMessage = typeof message === 'string' ? message : message;
        if (typeof finalMessage === 'string') {
            if (options.effort === 'high' || options.effort === 'max') {
                finalMessage = `ultrathink\n\n${finalMessage}`;
            }
            if (options.plan) {
                finalMessage = `/plan ${finalMessage}`;
            }
        }
        const payload = {
            type: 'user',
            message: {
                role: 'user',
                content: typeof finalMessage === 'string' ? [{ type: 'text', text: finalMessage }] : finalMessage,
            },
        };
        this.proc.stdin.write(JSON.stringify(payload) + '\n');
        if (options.callbacks)
            this._streamCallbacks = options.callbacks;
        if (options.waitForComplete) {
            this._isBusy = true;
            try {
                return await this._waitForTurnComplete(options.timeout || TURN_TIMEOUT_MS);
            }
            finally {
                this._isBusy = false;
                if (options.callbacks)
                    this._streamCallbacks = null;
            }
        }
        return { requestId, sent: true };
    }
    // ── One-shot mode send ──────────────────────────────────────────────────
    async _sendOneShot(message, options) {
        const requestId = ++this.currentRequestId;
        const textMessage = typeof message === 'string' ? message : JSON.stringify(message);
        if (!options.waitForComplete) {
            this._runOneShot(textMessage, options).catch((err) => this.emit(SESSION_EVENT.ERROR, err));
            return { requestId, sent: true };
        }
        this._isBusy = true;
        try {
            return await this._runOneShot(textMessage, options);
        }
        finally {
            this._isBusy = false;
        }
    }
    async _runOneShot(message, options) {
        const a = this.engineConfig.args;
        const args = [];
        // Print mode + message
        if (a.print)
            args.push(a.print);
        args.push(message);
        // Output format
        if (a.outputFormat && a.outputFormatValue)
            args.push(a.outputFormat, a.outputFormatValue);
        // Permission mode
        this._appendPermissionArgs(args);
        // Skip permissions
        if (this.options.dangerouslySkipPermissions && a.skipPermissions) {
            args.push(a.skipPermissions);
        }
        // Model
        if (this.options.model && a.model)
            args.push(a.model, this.options.model);
        // System prompts
        if (this.options.systemPrompt && a.systemPrompt) {
            args.push(a.systemPrompt, this.options.systemPrompt);
        }
        // Max turns
        if (this.options.maxTurns && a.maxTurns) {
            args.push(a.maxTurns, String(this.options.maxTurns));
        }
        // Effort
        if (this.options.effort && this.options.effort !== 'auto' && a.effort) {
            args.push(a.effort, this.options.effort);
        }
        // Workspace
        if (this.options.cwd && a.workspace) {
            args.push(a.workspace, this.options.cwd);
        }
        // Extra static args
        if (a.extra?.length)
            args.push(...a.extra);
        const timeout = options.timeout || 300_000;
        const spawnEnv = {
            ...process.env,
            ...this.engineConfig.env,
        };
        return new Promise((resolve, reject) => {
            const resultText = { value: '' };
            let stderr = '';
            let settled = false;
            let gotUsageFromEvents = false;
            const proc = spawn(this.engineBin, args, {
                cwd: this.options.cwd,
                env: spawnEnv,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            this.currentProc = proc;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    proc.kill('SIGTERM');
                    reject(new Error(`Timeout waiting for ${this.engineConfig.name} response`));
                }
            }, timeout);
            const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
            this._currentRl = rl;
            rl.on('line', (line) => {
                if (!line.trim())
                    return;
                try {
                    const event = JSON.parse(line);
                    this._handleOneShotEvent(event, options, resultText, () => {
                        gotUsageFromEvents = true;
                    });
                }
                catch {
                    // Non-JSON line — treat as plain text
                    resultText.value += line + '\n';
                    try {
                        options.callbacks?.onText?.(line + '\n');
                    }
                    catch {
                        /* ignore callback errors */
                    }
                    this.emit(SESSION_EVENT.TEXT, line + '\n');
                }
            });
            proc.stderr?.on('data', (data) => {
                const sanitized = this.sanitize(data.toString());
                stderr += sanitized;
                this.emit(SESSION_EVENT.LOG, `[${this.engineConfig.name}-stderr] ${sanitized}`);
            });
            proc.on('close', (code) => {
                clearTimeout(timer);
                this.currentProc = null;
                if (this._currentRl) {
                    this._currentRl.close();
                    this._currentRl = null;
                }
                if (settled)
                    return;
                settled = true;
                const now = new Date().toISOString();
                this._stats.turns++;
                this._stats.lastActivity = now;
                if (!gotUsageFromEvents && resultText.value.length > 0) {
                    this._stats.tokensIn += estimateTokens(message);
                    this._stats.tokensOut += estimateTokens(resultText.value);
                    this._updateCost();
                }
                this._history.push({ time: now, type: 'result', event: { text: resultText.value, code } });
                if (this._history.length > MAX_HISTORY_ITEMS)
                    this._history.shift();
                const event = {
                    type: 'result',
                    result: resultText.value,
                    stop_reason: code === 0 ? 'end_turn' : 'error',
                };
                this.emit(SESSION_EVENT.RESULT, event);
                this.emit(SESSION_EVENT.TURN_COMPLETE, event);
                if (code !== 0 && !resultText.value) {
                    reject(new Error(stderr || `${this.engineConfig.name} exited with code ${code}`));
                }
                else if (code !== 0) {
                    reject(new Error(stderr || `${this.engineConfig.name} exited with code ${code}`));
                }
                else {
                    resolve({ text: resultText.value, event });
                }
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            });
        });
    }
    // ─── Event Handling (Persistent mode) ───────────────────────────────────
    _handlePersistentEvent(event) {
        const type = event.type;
        this._stats.lastActivity = new Date().toISOString();
        this._history.push({ time: this._stats.lastActivity, type, event });
        if (this._history.length > MAX_HISTORY_ITEMS)
            this._history.shift();
        switch (type) {
            case 'system':
                if (event.subtype === 'init') {
                    this.sessionId = event.session_id;
                    this._startTime = new Date().toISOString();
                    this.emit(SESSION_EVENT.INIT, event);
                }
                this.emit(SESSION_EVENT.SYSTEM, event);
                break;
            case 'stream_event': {
                const inner = event.event;
                if (!inner)
                    break;
                const innerType = inner.type;
                if (innerType === 'content_block_start') {
                    const block = inner.content_block;
                    if (block?.type === 'tool_use') {
                        this._stats.toolCalls++;
                        const toolEvent = { tool: { name: block.name, input: {} } };
                        try {
                            this._streamCallbacks?.onToolUse?.(toolEvent);
                        }
                        catch {
                            /* ignore */
                        }
                        this.emit(SESSION_EVENT.TOOL_USE, toolEvent);
                    }
                }
                else if (innerType === 'content_block_delta') {
                    const delta = inner.delta;
                    if (delta?.type === 'text_delta' && delta.text) {
                        try {
                            this._streamCallbacks?.onText?.(delta.text);
                        }
                        catch {
                            /* ignore */
                        }
                        this.emit(SESSION_EVENT.TEXT, delta.text);
                    }
                }
                else if (innerType === 'message_delta') {
                    const usage = inner.usage;
                    if (usage) {
                        this._stats.tokensIn += usage.input_tokens || 0;
                        this._stats.tokensOut += usage.output_tokens || 0;
                        this._stats.cachedTokens += usage.cache_read_input_tokens || 0;
                        this._updateCost();
                    }
                }
                this.emit(SESSION_EVENT.STREAM_EVENT, event);
                break;
            }
            case 'user':
                this._stats.turns++;
                this.emit(SESSION_EVENT.USER_ECHO, event);
                break;
            case 'assistant':
                this.emit(SESSION_EVENT.ASSISTANT, event);
                if (event.message?.content && Array.isArray(event.message.content)) {
                    for (const block of event.message.content) {
                        if (block.type === 'tool_use') {
                            this._stats.toolCalls++;
                            const toolEvent = {
                                tool: {
                                    name: block.name,
                                    input: block.input || {},
                                },
                            };
                            try {
                                this._streamCallbacks?.onToolUse?.(toolEvent);
                            }
                            catch {
                                /* ignore */
                            }
                            this.emit(SESSION_EVENT.TOOL_USE, toolEvent);
                        }
                    }
                }
                break;
            case 'tool_use':
                this._stats.toolCalls++;
                try {
                    this._streamCallbacks?.onToolUse?.(event);
                }
                catch {
                    /* ignore */
                }
                this.emit(SESSION_EVENT.TOOL_USE, event);
                break;
            case 'tool_result':
                try {
                    this._streamCallbacks?.onToolResult?.(event);
                }
                catch {
                    /* ignore */
                }
                if (event.is_error || event.error) {
                    this._stats.toolErrors++;
                }
                this.emit(SESSION_EVENT.TOOL_RESULT, event);
                break;
            case 'error':
                this.emit(SESSION_EVENT.ERROR, new Error(String(event.error) || JSON.stringify(event)));
                break;
            case 'result': {
                const usage = event.usage;
                if (usage) {
                    this._stats.tokensIn += usage.input_tokens || 0;
                    this._stats.tokensOut += usage.output_tokens || 0;
                    this._stats.cachedTokens += usage.cache_read_input_tokens || 0;
                    this._updateCost();
                }
                this.emit(SESSION_EVENT.RESULT, event);
                this.emit(SESSION_EVENT.TURN_COMPLETE, event);
                const totalTokens = this._stats.tokensIn + this._stats.tokensOut;
                if (totalTokens > CONTEXT_HIGH_THRESHOLD && !this._contextHighFired) {
                    this._contextHighFired = true;
                }
                break;
            }
            default:
                this.emit(SESSION_EVENT.EVENT, event);
        }
    }
    // ─── Event Handling (One-shot mode) ─────────────────────────────────────
    _handleOneShotEvent(event, options, resultText, markUsageReceived) {
        const type = event.type;
        switch (type) {
            case 'system':
                if (event.session_id)
                    this.sessionId = String(event.session_id);
                break;
            case 'user':
                // Echo of user prompt — skip
                break;
            case 'assistant': {
                const msg = event.message;
                if (!msg)
                    break;
                const contentArr = msg.content;
                if (contentArr) {
                    for (const block of contentArr) {
                        if (block.type === 'text' && block.text) {
                            resultText.value += block.text;
                            try {
                                options.callbacks?.onText?.(block.text);
                            }
                            catch {
                                /* ignore */
                            }
                            this.emit(SESSION_EVENT.TEXT, block.text);
                        }
                    }
                }
                break;
            }
            case 'message': {
                if (event.role === 'user')
                    break;
                const text = event.content || '';
                if (text) {
                    resultText.value += text;
                    try {
                        options.callbacks?.onText?.(text);
                    }
                    catch {
                        /* ignore */
                    }
                    this.emit(SESSION_EVENT.TEXT, text);
                }
                break;
            }
            case 'tool_use':
                this._stats.toolCalls++;
                try {
                    options.callbacks?.onToolUse?.(event);
                }
                catch {
                    /* ignore */
                }
                this.emit(SESSION_EVENT.TOOL_USE, event);
                break;
            case 'tool_result':
                try {
                    options.callbacks?.onToolResult?.(event);
                }
                catch {
                    /* ignore */
                }
                if (event.is_error)
                    this._stats.toolErrors++;
                this.emit(SESSION_EVENT.TOOL_RESULT, event);
                break;
            case 'result': {
                const usage = event.usage;
                if (usage) {
                    this._stats.tokensIn += usage.input_tokens || usage.inputTokens || usage.prompt_tokens || 0;
                    this._stats.tokensOut += usage.output_tokens || usage.outputTokens || usage.completion_tokens || 0;
                    const cached = usage.cache_read_input_tokens || usage.cached_tokens || 0;
                    if (cached)
                        this._stats.cachedTokens += cached;
                    this._updateCost();
                    markUsageReceived();
                }
                const resultStr = event.result;
                if (resultStr && !resultText.value)
                    resultText.value = resultStr;
                break;
            }
            case 'error':
                this.emit(SESSION_EVENT.LOG, `[${this.engineConfig.name}-error] ${event.error || JSON.stringify(event)}`);
                break;
            default:
                break;
        }
    }
    // ─── Wait for Turn Complete (Persistent mode) ───────────────────────────
    _waitForTurnComplete(timeout) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let streamedText = '';
            let allAssistantText = '';
            const toolNames = [];
            const onText = (chunk) => {
                streamedText += chunk;
            };
            this.on(SESSION_EVENT.TEXT, onText);
            const onAssistant = (event) => {
                if (event.message?.content && Array.isArray(event.message.content)) {
                    for (const block of event.message.content) {
                        if (block.type === 'text' && block.text)
                            allAssistantText += block.text + '\n';
                    }
                }
            };
            this.on(SESSION_EVENT.ASSISTANT, onAssistant);
            const onToolUse = (event) => {
                const tool = event.tool;
                toolNames.push(tool?.name || event.name || 'unknown');
            };
            this.on(SESSION_EVENT.TOOL_USE, onToolUse);
            const cleanup = () => {
                clearTimeout(timer);
                this.removeListener(SESSION_EVENT.TEXT, onText);
                this.removeListener(SESSION_EVENT.ASSISTANT, onAssistant);
                this.removeListener(SESSION_EVENT.TOOL_USE, onToolUse);
                this.removeListener(SESSION_EVENT.TURN_COMPLETE, onTurnComplete);
                this.removeListener(SESSION_EVENT.ERROR, onError);
                this.removeListener(SESSION_EVENT.CLOSE, onClose);
            };
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(new Error('Timeout waiting for response'));
            }, timeout);
            const onTurnComplete = (event) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                let text = event.result || streamedText || allAssistantText.trim() || '';
                if (!text && toolNames.length > 0) {
                    const unique = [...new Set(toolNames)];
                    text = `[Agent completed ${toolNames.length} tool calls: ${unique.join(', ')}]`;
                }
                resolve({ text, event });
            };
            const onError = (err) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(err);
            };
            const onClose = (code) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                const text = streamedText || allAssistantText.trim() || '';
                resolve({
                    text,
                    event: {
                        type: 'result',
                        result: text,
                        stop_reason: 'process_exit',
                        exit_code: code,
                    },
                });
            };
            this.once(SESSION_EVENT.TURN_COMPLETE, onTurnComplete);
            this.once(SESSION_EVENT.ERROR, onError);
            this.once(SESSION_EVENT.CLOSE, onClose);
        });
    }
    // ─── Utilities ───────────────────────────────────────────────────────────
    getStats() {
        const ctxWindow = this.engineConfig.contextWindow ?? 200_000;
        return {
            turns: this._stats.turns,
            toolCalls: this._stats.toolCalls,
            toolErrors: this._stats.toolErrors,
            tokensIn: this._stats.tokensIn,
            tokensOut: this._stats.tokensOut,
            cachedTokens: this._stats.cachedTokens,
            costUsd: Math.round(this._stats.costUsd * 10000) / 10000,
            isReady: this._isReady,
            startTime: this._startTime,
            lastActivity: this._stats.lastActivity,
            contextPercent: this.engineConfig.persistent
                ? Math.min(100, Math.round(((this._stats.tokensIn + this._stats.tokensOut) / ctxWindow) * 100))
                : 0,
            retries: 0,
            sessionId: this.sessionId,
            uptime: this._startTime ? Math.round((Date.now() - new Date(this._startTime).getTime()) / 1000) : 0,
        };
    }
    getHistory(limit = DEFAULT_HISTORY_LIMIT) {
        return this._history.slice(-limit);
    }
    async compact(summary) {
        if (!this.engineConfig.persistent) {
            const event = {
                type: 'result',
                result: `${this.engineConfig.name} engine does not support compaction (one-shot mode)`,
            };
            return { text: event.result, event };
        }
        const msg = summary ? `/compact ${summary}` : '/compact';
        return this.send(msg, { waitForComplete: true, timeout: COMPACT_TIMEOUT_MS });
    }
    getEffort() {
        return this.options.effort || 'auto';
    }
    setEffort(level) {
        this.options.effort = level;
    }
    getCost() {
        const pricing = getModelPricing(this.options.model, this.engineConfig);
        const cachedPrice = pricing.cached ?? 0;
        const nonCachedIn = Math.max(0, this._stats.tokensIn - this._stats.cachedTokens);
        return {
            model: this.options.model || this.engineConfig.name,
            tokensIn: this._stats.tokensIn,
            tokensOut: this._stats.tokensOut,
            cachedTokens: this._stats.cachedTokens,
            pricing: { inputPer1M: pricing.input, outputPer1M: pricing.output, cachedPer1M: cachedPrice || undefined },
            breakdown: {
                inputCost: (nonCachedIn / 1_000_000) * pricing.input,
                cachedCost: (this._stats.cachedTokens / 1_000_000) * cachedPrice,
                outputCost: (this._stats.tokensOut / 1_000_000) * pricing.output,
            },
            totalUsd: this._stats.costUsd,
        };
    }
    resolveModel(alias) {
        return resolveAlias(alias);
    }
    pause() {
        this._isPaused = true;
        this.emit(SESSION_EVENT.PAUSED, { sessionId: this.sessionId });
    }
    resume() {
        this._isPaused = false;
        this.emit(SESSION_EVENT.RESUMED, { sessionId: this.sessionId });
    }
    stop() {
        // Persistent mode cleanup
        if (this._rl) {
            this._rl.close();
            this._rl = null;
        }
        if (this.proc) {
            const pid = this.proc.pid;
            this.proc.stdin?.end();
            this.proc.stdout?.destroy();
            this.proc.stderr?.destroy();
            try {
                process.kill(-pid, 'SIGTERM');
            }
            catch (err) {
                if (err.code !== 'ESRCH') {
                    try {
                        this.proc.kill('SIGTERM');
                    }
                    catch {
                        /* ESRCH expected */
                    }
                }
            }
            const p = this.proc;
            setTimeout(() => {
                try {
                    process.kill(-pid, 'SIGKILL');
                }
                catch {
                    /* ESRCH expected */
                }
                try {
                    p.kill('SIGKILL');
                }
                catch {
                    /* ESRCH expected */
                }
            }, STOP_SIGKILL_DELAY_MS);
            this.proc = null;
        }
        // One-shot mode cleanup
        if (this._currentRl) {
            this._currentRl.close();
            this._currentRl = null;
        }
        if (this.currentProc) {
            this.currentProc.stdin?.end();
            this.currentProc.stdout?.destroy();
            this.currentProc.stderr?.destroy();
            try {
                this.currentProc.kill('SIGTERM');
            }
            catch {
                /* ignore */
            }
            this.currentProc = null;
        }
        this._isReady = false;
        this._isPaused = false;
        this.emit(SESSION_EVENT.CLOSE, 143);
    }
    // ─── Private ─────────────────────────────────────────────────────────────
    _appendPermissionArgs(args) {
        const a = this.engineConfig.args;
        const mode = this.options.permissionMode;
        if (!mode || !a.permissionMode)
            return;
        // Map mode name if the engine uses different names
        const mapped = this.engineConfig.permissionModes?.[mode] ?? mode;
        args.push(a.permissionMode, mapped);
    }
    _updateCost() {
        const pricing = getModelPricing(this.options.model, this.engineConfig);
        const cachedPrice = pricing.cached ?? 0;
        const nonCachedIn = Math.max(0, this._stats.tokensIn - this._stats.cachedTokens);
        this._stats.costUsd =
            (nonCachedIn / 1_000_000) * pricing.input +
                (this._stats.cachedTokens / 1_000_000) * cachedPrice +
                (this._stats.tokensOut / 1_000_000) * pricing.output;
    }
}
//# sourceMappingURL=persistent-custom-session.js.map