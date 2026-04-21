/**
 * Persistent Cursor Session — wraps `cursor-agent` CLI
 *
 * Like Codex/Gemini, each send() spawns a new `cursor-agent` process in
 * headless print mode. Cursor CLI supports `--output-format stream-json`
 * which provides NDJSON events similar to Gemini's stream protocol.
 *
 * The "session" is persistent in the same sense as Codex:
 *   - Working directory carries accumulated code changes across sends
 *   - Stats, history, and cost are tracked continuously
 *   - Consistent lifecycle semantics (start/stop/pause/resume)
 */
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { estimateTokens } from './models.js';
import { SESSION_EVENT } from './constants.js';
import { BaseOneShotSession } from './base-oneshot-session.js';
// ─── PersistentCursorSession ────────────────────────────────────────────────
export class PersistentCursorSession extends BaseOneShotSession {
    _currentRl = null;
    constructor(config, cursorBin) {
        super(config, cursorBin || process.env.CURSOR_BIN || 'agent', {
            enginePrefix: 'cursor',
            defaultModel: 'claude-sonnet-4-6',
            defaultModelDisplay: 'cursor-default',
            supportsCachedTokens: true,
            engineDisplayName: 'Cursor',
        });
    }
    _cleanupProc() {
        if (this._currentRl) {
            this._currentRl.close();
            this._currentRl = null;
        }
        if (this.currentProc) {
            this.currentProc.stdin?.end();
            this.currentProc.stdout?.destroy();
            this.currentProc.stderr?.destroy();
        }
        super._cleanupProc();
    }
    _run(message, options) {
        // agent -p <prompt> --force --trust --output-format stream-json
        const args = ['-p', message, '--force', '--trust', '--output-format', 'stream-json'];
        if (this.options.model)
            args.push('--model', this.options.model);
        // Workspace directory (prefer --workspace over cwd for explicit path)
        if (this.options.cwd)
            args.push('--workspace', this.options.cwd);
        const timeout = options.timeout || 300_000;
        return new Promise((resolve, reject) => {
            const resultText = { value: '' };
            let stderr = '';
            let settled = false;
            let gotUsageFromEvents = false;
            const proc = spawn(this.engineBin, args, {
                cwd: this.options.cwd,
                // SECURITY FIX: allowlist env vars instead of inheriting all
                env: {
                    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                    HOME: process.env.HOME,
                    USER: process.env.USER,
                    SHELL: process.env.SHELL,
                    LANG: process.env.LANG,
                    TERM: process.env.TERM || 'xterm-256color',
                    TMPDIR: process.env.TMPDIR,
                    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
                    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
                    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
                    SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
                    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
                    HTTP_PROXY: process.env.HTTP_PROXY,
                    HTTPS_PROXY: process.env.HTTPS_PROXY,
                    NO_PROXY: process.env.NO_PROXY,
                    NODE_ENV: process.env.NODE_ENV,
                },
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            this.currentProc = proc;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    proc.kill('SIGTERM');
                    reject(new Error('Timeout waiting for Cursor response'));
                }
            }, timeout);
            // Parse stream-json output line by line
            const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
            this._currentRl = rl;
            rl.on('line', (line) => {
                if (!line.trim())
                    return;
                try {
                    const event = JSON.parse(line);
                    this._handleStreamEvent(event, options, resultText, () => {
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
                        // User callback error
                    }
                    this.emit(SESSION_EVENT.TEXT, line + '\n');
                }
            });
            proc.stderr?.on('data', (data) => {
                const sanitized = data
                    .toString()
                    .replace(/CURSOR_API_KEY=[^\s]+/g, 'CURSOR_API_KEY=***')
                    .replace(/Bearer [a-zA-Z0-9_-]+/g, 'Bearer ***');
                stderr += sanitized;
                this.emit(SESSION_EVENT.LOG, `[cursor-stderr] ${sanitized}`);
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
                this._recordTurnComplete();
                // Fallback: estimate tokens if stream events didn't provide usage
                if (!gotUsageFromEvents && resultText.value.length > 0) {
                    this._stats.tokensIn += estimateTokens(message);
                    this._stats.tokensOut += estimateTokens(resultText.value);
                    this._updateCost();
                }
                this._addHistory({ text: resultText.value, code });
                const event = {
                    type: 'result',
                    result: resultText.value,
                    stop_reason: code === 0 ? 'end_turn' : 'error',
                };
                this.emit(SESSION_EVENT.RESULT, event);
                this.emit(SESSION_EVENT.TURN_COMPLETE, event);
                if (code !== 0) {
                    reject(new Error(stderr || `Cursor exited with code ${code}`));
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
    // ─── Stream Event Handling ────────────────────────────────────────────
    _handleStreamEvent(event, options, resultText, markUsageReceived) {
        const type = event.type;
        switch (type) {
            case 'system':
                // Init event — extract session_id if available
                if (event.session_id && !this.sessionId?.startsWith('cursor-live-')) {
                    this.sessionId = `cursor-live-${event.session_id}`;
                }
                break;
            case 'user':
                // Echo of user prompt — skip
                break;
            case 'assistant': {
                // Cursor format: { type: "assistant", message: { role, content: [{ type, text }] } }
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
                                // User callback error
                            }
                            this.emit(SESSION_EVENT.TEXT, block.text);
                        }
                    }
                }
                break;
            }
            // Also support generic "message" format for forward compatibility
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
                        // User callback error
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
                    // User callback error
                }
                this.emit(SESSION_EVENT.TOOL_USE, event);
                break;
            case 'tool_result':
                try {
                    options.callbacks?.onToolResult?.(event);
                }
                catch {
                    // User callback error
                }
                if (event.is_error)
                    this._stats.toolErrors++;
                this.emit(SESSION_EVENT.TOOL_RESULT, event);
                break;
            case 'result': {
                // Cursor uses camelCase: inputTokens, outputTokens, cacheReadTokens
                const usage = event.usage;
                if (usage) {
                    this._stats.tokensIn += usage.inputTokens || usage.input_tokens || usage.prompt_tokens || 0;
                    this._stats.tokensOut += usage.outputTokens || usage.output_tokens || usage.completion_tokens || 0;
                    const cached = usage.cacheReadTokens || usage.cached_tokens || 0;
                    if (cached)
                        this._stats.cachedTokens += cached;
                    this._updateCost();
                    markUsageReceived();
                }
                // Result text (if not already captured from assistant events)
                const resultStr = event.result;
                if (resultStr && !resultText.value)
                    resultText.value = resultStr;
                break;
            }
            case 'error':
                this.emit(SESSION_EVENT.LOG, `[cursor-error] ${event.error || JSON.stringify(event)}`);
                break;
            default:
                break;
        }
    }
}
//# sourceMappingURL=persistent-cursor-session.js.map