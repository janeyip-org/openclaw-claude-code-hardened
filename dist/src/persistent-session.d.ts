/**
 * Persistent Claude Code Session — wraps `claude` CLI via child_process.spawn
 *
 * Maintains a long-running Claude Code process with streaming JSON I/O.
 * Enables multi-turn agent loops, continuous conversation, and real-time streaming.
 */
import { EventEmitter } from 'node:events';
import { type SessionConfig, type SessionStats, type EffortLevel, type ISession, type SessionSendOptions, type TurnResult, type CostBreakdown } from './types.js';
interface InternalStats {
    turns: number;
    toolCalls: number;
    toolErrors: number;
    tokensIn: number;
    tokensOut: number;
    cachedTokens: number;
    costUsd: number;
    startTime: string | null;
    lastActivity: string | null;
    history: Array<{
        time: string;
        type: string;
        event: unknown;
    }>;
    retries: number;
    lastRetryError?: string;
}
export declare class PersistentClaudeSession extends EventEmitter implements ISession {
    private options;
    private claudeBin;
    private proc;
    private _rl;
    private _isReady;
    private _isPaused;
    private _isBusy;
    private currentRequestId;
    private _streamCallbacks;
    private _contextHighFired;
    private _realModel;
    sessionId?: string;
    stats: InternalStats;
    constructor(config: SessionConfig, claudeBin?: string);
    get pid(): number | undefined;
    get isReady(): boolean;
    get isPaused(): boolean;
    get isBusy(): boolean;
    start(): Promise<this>;
    private _handleEvent;
    send(message: string | unknown[], options?: SessionSendOptions): Promise<TurnResult | {
        requestId: number;
        sent: boolean;
    }>;
    private _waitForTurnComplete;
    getStats(): SessionStats & {
        sessionId?: string;
        uptime: number;
    };
    getHistory(limit?: number): Array<{
        time: string;
        type: string;
        event: unknown;
    }>;
    compact(summary?: string): Promise<TurnResult | {
        requestId: number;
        sent: boolean;
    }>;
    getEffort(): EffortLevel;
    setEffort(level: EffortLevel): void;
    getCost(): CostBreakdown;
    resolveModel(alias: string): string;
    pause(): void;
    resume(): void;
    stop(): void;
    private _updateCost;
    private _fireHook;
}
export {};
