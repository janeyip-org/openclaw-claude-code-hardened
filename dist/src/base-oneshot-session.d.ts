/**
 * Base class for one-shot (process-per-send) session engines.
 *
 * Shared by Codex, Gemini, and Cursor — eliminates ~200 LOC of duplication
 * per engine. Subclasses only implement _run() (engine-specific CLI invocation)
 * and optionally override _cleanupProc() for extra cleanup (readline, streams).
 */
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { type SessionConfig, type SessionStats, type EffortLevel, type ISession, type SessionSendOptions, type TurnResult, type CostBreakdown } from './types.js';
/**
 * Parameterizes engine-specific behavior without requiring method overrides.
 * Passed to the BaseOneShotSession constructor by each subclass.
 */
export interface OneShotEngineConfig {
    /** Prefix for session ID generation, e.g. 'codex', 'gemini', 'cursor' */
    enginePrefix: string;
    /** Fallback model for pricing lookups when session has no explicit model */
    defaultModel: string;
    /** Model name shown in getCost() output; defaults to defaultModel if omitted */
    defaultModelDisplay?: string;
    /** Whether this engine tracks cached token pricing (Codex=false, Gemini/Cursor=true) */
    supportsCachedTokens: boolean;
    /** Human-readable engine name for compact() no-op message */
    engineDisplayName: string;
}
export declare abstract class BaseOneShotSession extends EventEmitter implements ISession {
    protected options: SessionConfig;
    protected engineBin: string;
    protected engineCfg: OneShotEngineConfig;
    private _isReady;
    private _isPaused;
    private _isBusy;
    protected currentProc: ChildProcess | null;
    private currentRequestId;
    private _startTime;
    private _history;
    sessionId?: string;
    protected _stats: {
        turns: number;
        toolCalls: number;
        toolErrors: number;
        tokensIn: number;
        tokensOut: number;
        cachedTokens: number;
        costUsd: number;
        lastActivity: string | null;
    };
    constructor(config: SessionConfig, bin: string, engineCfg: OneShotEngineConfig);
    get pid(): number | undefined;
    get isReady(): boolean;
    get isPaused(): boolean;
    get isBusy(): boolean;
    start(): Promise<this>;
    send(message: string | unknown[], options?: SessionSendOptions): Promise<TurnResult | {
        requestId: number;
        sent: boolean;
    }>;
    /** Engine-specific: spawn the CLI and return a TurnResult. */
    protected abstract _run(message: string, options: SessionSendOptions): Promise<TurnResult>;
    getStats(): SessionStats & {
        sessionId?: string;
        uptime: number;
    };
    getHistory(limit?: number): Array<{
        time: string;
        type: string;
        event: unknown;
    }>;
    compact(_summary?: string): Promise<TurnResult>;
    getEffort(): EffortLevel;
    setEffort(level: EffortLevel): void;
    getCost(): CostBreakdown;
    resolveModel(alias: string): string;
    pause(): void;
    resume(): void;
    stop(): void;
    /** Override in subclasses that need extra cleanup (readline, stream destroy). */
    protected _cleanupProc(): void;
    protected _getModelPricing(): import("./models.js").ModelPricing;
    protected _recordTurnComplete(): void;
    protected _addHistory(event: {
        text: string;
        code: number | null;
    }): void;
    protected _updateCost(): void;
}
