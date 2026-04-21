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
import { EventEmitter } from 'node:events';
import { type SessionConfig, type SessionStats, type EffortLevel, type ISession, type SessionSendOptions, type TurnResult, type CostBreakdown } from './types.js';
export declare class PersistentCustomSession extends EventEmitter implements ISession {
    private options;
    private engineConfig;
    private engineBin;
    private sanitize;
    private proc;
    private _rl;
    private _streamCallbacks;
    private _contextHighFired;
    private currentProc;
    private _currentRl;
    private _isReady;
    private _isPaused;
    private _isBusy;
    private currentRequestId;
    private _startTime;
    private _history;
    sessionId?: string;
    private _stats;
    constructor(config: SessionConfig);
    get pid(): number | undefined;
    get isReady(): boolean;
    get isPaused(): boolean;
    get isBusy(): boolean;
    start(): Promise<this>;
    private _startPersistent;
    private _startOneShot;
    send(message: string | unknown[], options?: SessionSendOptions): Promise<TurnResult | {
        requestId: number;
        sent: boolean;
    }>;
    private _sendPersistent;
    private _sendOneShot;
    private _runOneShot;
    private _handlePersistentEvent;
    private _handleOneShotEvent;
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
    private _appendPermissionArgs;
    private _updateCost;
}
