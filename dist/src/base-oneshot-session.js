/**
 * Base class for one-shot (process-per-send) session engines.
 *
 * Shared by Codex, Gemini, and Cursor — eliminates ~200 LOC of duplication
 * per engine. Subclasses only implement _run() (engine-specific CLI invocation)
 * and optionally override _cleanupProc() for extra cleanup (readline, streams).
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getModelPricing as _getModelPricingBase, } from './types.js';
import { resolveAlias } from './models.js';
import { MAX_HISTORY_ITEMS, DEFAULT_HISTORY_LIMIT, SESSION_EVENT } from './constants.js';
// ─── BaseOneShotSession ────────────────────────────────────────────────────
export class BaseOneShotSession extends EventEmitter {
    options;
    engineBin;
    engineCfg;
    _isReady = false;
    _isPaused = false;
    _isBusy = false;
    currentProc = null;
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
    constructor(config, bin, engineCfg) {
        super();
        this.engineBin = bin;
        this.engineCfg = engineCfg;
        this.options = {
            ...config,
            permissionMode: config.permissionMode || 'bypassPermissions',
        };
    }
    // ── Property Accessors ─────────────────────────────────────────────────
    get pid() {
        return this.currentProc?.pid ?? undefined;
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
    // ── start() ────────────────────────────────────────────────────────────
    async start() {
        if (this.options.cwd) {
            this.options.cwd = path.resolve(this.options.cwd);
            if (!fs.existsSync(this.options.cwd)) {
                fs.mkdirSync(this.options.cwd, { recursive: true });
            }
        }
        this.sessionId = `${this.engineCfg.enginePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this._startTime = new Date().toISOString();
        this._isReady = true;
        this.emit(SESSION_EVENT.READY);
        this.emit(SESSION_EVENT.INIT, { type: 'system', subtype: 'init', session_id: this.sessionId });
        return this;
    }
    // ── send() ─────────────────────────────────────────────────────────────
    async send(message, options = {}) {
        if (!this._isReady)
            throw new Error('Session not ready. Call start() first.');
        const requestId = ++this.currentRequestId;
        const textMessage = typeof message === 'string' ? message : JSON.stringify(message);
        if (!options.waitForComplete) {
            this._run(textMessage, options).catch((err) => this.emit(SESSION_EVENT.ERROR, err));
            return { requestId, sent: true };
        }
        this._isBusy = true;
        try {
            return await this._run(textMessage, options);
        }
        finally {
            this._isBusy = false;
        }
    }
    // ── getStats() ─────────────────────────────────────────────────────────
    getStats() {
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
            contextPercent: 0,
            retries: 0,
            sessionId: this.sessionId,
            uptime: this._startTime ? Math.round((Date.now() - new Date(this._startTime).getTime()) / 1000) : 0,
        };
    }
    // ── getHistory() ───────────────────────────────────────────────────────
    getHistory(limit = DEFAULT_HISTORY_LIMIT) {
        return this._history.slice(-limit);
    }
    // ── compact() ──────────────────────────────────────────────────────────
    async compact(_summary) {
        const event = {
            type: 'result',
            result: `${this.engineCfg.engineDisplayName} engine does not support compaction`,
        };
        return { text: event.result, event };
    }
    // ── Effort ─────────────────────────────────────────────────────────────
    getEffort() {
        return this.options.effort || 'auto';
    }
    setEffort(level) {
        this.options.effort = level;
    }
    // ── getCost() ──────────────────────────────────────────────────────────
    getCost() {
        const pricing = this._getModelPricing();
        const displayModel = this.options.model || this.engineCfg.defaultModelDisplay || this.engineCfg.defaultModel;
        if (this.engineCfg.supportsCachedTokens) {
            const cachedPrice = pricing.cached ?? 0;
            const nonCachedIn = Math.max(0, this._stats.tokensIn - this._stats.cachedTokens);
            return {
                model: displayModel,
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
        // Non-cached path (e.g. Codex)
        return {
            model: displayModel,
            tokensIn: this._stats.tokensIn,
            tokensOut: this._stats.tokensOut,
            cachedTokens: 0,
            pricing: { inputPer1M: pricing.input, outputPer1M: pricing.output, cachedPer1M: undefined },
            breakdown: {
                inputCost: (this._stats.tokensIn / 1_000_000) * pricing.input,
                cachedCost: 0,
                outputCost: (this._stats.tokensOut / 1_000_000) * pricing.output,
            },
            totalUsd: this._stats.costUsd,
        };
    }
    // ── resolveModel() ─────────────────────────────────────────────────────
    resolveModel(alias) {
        return resolveAlias(alias);
    }
    // ── pause / resume ─────────────────────────────────────────────────────
    pause() {
        this._isPaused = true;
        this.emit(SESSION_EVENT.PAUSED, { sessionId: this.sessionId });
    }
    resume() {
        this._isPaused = false;
        this.emit(SESSION_EVENT.RESUMED, { sessionId: this.sessionId });
    }
    // ── stop() ─────────────────────────────────────────────────────────────
    stop() {
        this._cleanupProc();
        this._isReady = false;
        this._isPaused = false;
        this.emit(SESSION_EVENT.CLOSE, 143);
    }
    /** Override in subclasses that need extra cleanup (readline, stream destroy). */
    _cleanupProc() {
        if (this.currentProc) {
            try {
                this.currentProc.kill('SIGTERM');
            }
            catch {
                // Process may have already exited
            }
            this.currentProc = null;
        }
    }
    // ── Protected Helpers (for subclass _run() implementations) ────────────
    _getModelPricing() {
        return _getModelPricingBase(this.options.model, this.engineCfg.defaultModel);
    }
    _recordTurnComplete() {
        this._stats.turns++;
        this._stats.lastActivity = new Date().toISOString();
    }
    _addHistory(event) {
        const now = this._stats.lastActivity || new Date().toISOString();
        this._history.push({ time: now, type: 'result', event });
        if (this._history.length > MAX_HISTORY_ITEMS)
            this._history.shift();
    }
    _updateCost() {
        const pricing = this._getModelPricing();
        if (this.engineCfg.supportsCachedTokens) {
            const cachedPrice = pricing.cached ?? 0;
            const nonCachedIn = Math.max(0, this._stats.tokensIn - this._stats.cachedTokens);
            this._stats.costUsd =
                (nonCachedIn / 1_000_000) * pricing.input +
                    (this._stats.cachedTokens / 1_000_000) * cachedPrice +
                    (this._stats.tokensOut / 1_000_000) * pricing.output;
        }
        else {
            this._stats.costUsd =
                (this._stats.tokensIn / 1_000_000) * pricing.input + (this._stats.tokensOut / 1_000_000) * pricing.output;
        }
    }
}
//# sourceMappingURL=base-oneshot-session.js.map