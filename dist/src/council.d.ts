/**
 * Council — Multi-agent collaboration engine
 *
 * Ported from three-minds and adapted to use SessionManager + ISession
 * directly (no HTTP/SSE to external services).
 *
 * Key patterns:
 * - Git worktree isolation per agent
 * - Two-phase protocol: planning round → execution rounds
 * - Consensus voting: all agents vote YES to complete
 * - Parallel execution via Promise.allSettled
 * - Engine-agnostic: agents can use Claude, Codex, or any ISession engine
 */
import { EventEmitter } from 'node:events';
import { type CouncilConfig, type CouncilSession, type CouncilReviewResult, type CouncilAcceptResult, type CouncilRejectResult, type SessionConfig, type SessionInfo, type SendOptions, type SendResult } from './types.js';
import { type Logger } from './logger.js';
interface SessionManagerLike {
    startSession(config: Partial<SessionConfig> & {
        name?: string;
    }): Promise<SessionInfo>;
    sendMessage(name: string, message: string, options?: Partial<SendOptions>): Promise<SendResult>;
    stopSession(name: string): Promise<void>;
}
export declare class Council extends EventEmitter {
    private config;
    private manager;
    private agentTimeoutMs;
    private _aborted;
    private _activeSessions;
    /** Sessions kept alive across rounds for prompt caching (Claude only) */
    private _persistentSessions;
    private _session;
    private _pendingInjection;
    private logger;
    constructor(config: CouncilConfig, manager: SessionManagerLike, logger?: Logger);
    getSession(): CouncilSession | undefined;
    injectMessage(message: string): void;
    abort(): void;
    private emitEvent;
    private runSingleAgent;
    init(task: string): CouncilSession;
    run(task?: string): Promise<CouncilSession>;
    private generateSummary;
    private generateCompactContext;
    private saveTranscript;
    /**
     * Produce a structured review of the council's output.
     * Lists all changed files, branches, worktrees, plan.md status, and agent summaries.
     * Does NOT modify any state — purely informational.
     */
    review(): Promise<CouncilReviewResult>;
    /**
     * Internal cleanup helper — removes worktrees, branches, plan.md, and reviews/.
     * Each cleanup step is independently gated by the `options` flags.
     */
    private _cleanup;
    /**
     * Accept the council's work: clean up worktrees, branches, plan.md, and reviews/.
     * Should only be called after reviewing via `review()`.
     */
    accept(): Promise<CouncilAcceptResult>;
    /**
     * Reject the council's work: rewrite plan.md with feedback.
     * Does NOT delete any worktrees or branches — the council can retry.
     */
    reject(feedback: string): Promise<CouncilRejectResult>;
}
export declare function getDefaultCouncilConfig(projectDir: string): CouncilConfig;
export {};
