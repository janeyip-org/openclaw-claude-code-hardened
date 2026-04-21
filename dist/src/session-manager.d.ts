/**
 * SessionManager — manages multiple PersistentClaudeSession instances
 *
 * Replaces the Express server layer. Pure class with no HTTP dependency.
 * Can be used by Plugin tools, CLI, or any other consumer.
 */
interface PersistedSession {
    name: string;
    claudeSessionId: string;
    cwd: string;
    model?: string;
    engine?: EngineType;
    originalCreated: string;
    lastResumed: string;
    lastActivity: number;
}
import { type Logger } from './logger.js';
import { type SessionConfig, type SessionInfo, type SendResult, type PluginConfig, type EffortLevel, type EngineType, type AgentInfo, type SkillInfo, type RuleInfo, type StreamEvent, type ISession, type CouncilConfig, type CouncilSession, type CouncilReviewResult, type CouncilAcceptResult, type CouncilRejectResult, type InboxMessage, type UltraplanResult, type UltrareviewResult } from './types.js';
interface SendOptions {
    effort?: EffortLevel;
    plan?: boolean;
    autoResume?: boolean;
    timeout?: number;
    onEvent?: (event: StreamEvent) => void;
    onChunk?: (chunk: string) => void;
}
export declare class SessionManager {
    private sessions;
    private _pendingSessions;
    private cleanupTimer;
    private pluginConfig;
    private persistedSessions;
    private _debouncedSave;
    private _proxyServer;
    private _proxyPort;
    private _activePids;
    private _circuitBreaker;
    private _inbox;
    private logger;
    constructor(config?: Partial<PluginConfig>, logger?: Logger);
    startSession(config: Partial<SessionConfig> & {
        name?: string;
    }): Promise<SessionInfo>;
    private _doStartSession;
    sendMessage(name: string, message: string, options?: SendOptions): Promise<SendResult>;
    stopSession(name: string): Promise<void>;
    listSessions(): SessionInfo[];
    listPersistedSessions(): PersistedSession[];
    getStatus(name: string): SessionInfo & {
        stats: ReturnType<ISession['getStats']>;
    };
    grepSession(name: string, pattern: string, limit?: number): Promise<Array<{
        time: string;
        type: string;
        content: string;
    }>>;
    compactSession(name: string, summary?: string): Promise<void>;
    setEffort(name: string, level: EffortLevel): void;
    /**
     * Switch model for a session.
     * Updates in-memory config only (takes effect on next restart/resume).
     * For immediate effect, call restartWithConfig() explicitly.
     */
    setModel(name: string, model: string): void;
    /**
     * Switch model immediately by restarting the session with --resume.
     * Conversation history is preserved via the claude session ID.
     *
     * Guards:
     * - Rejects if session is currently processing a message (busy guard)
     * - Validates model string against known aliases before restarting
     * - Rolls back to old session if startSession fails
     */
    switchModel(name: string, model: string): Promise<SessionInfo>;
    /**
     * Update allowedTools or disallowedTools at runtime.
     *
     * The claude CLI does not support changing tool lists while running, so
     * the only way to apply new constraints is to restart the process with
     * the updated flags and --resume to replay conversation history.
     *
     * Guards:
     * - Rejects if session is busy
     * - Rolls back to old session if startSession fails
     * - merge:true adds tools; removeTools removes specific tools from the list
     */
    updateTools(name: string, opts: {
        allowedTools?: string[];
        disallowedTools?: string[];
        removeTools?: string[];
        merge?: boolean;
    }): Promise<SessionInfo>;
    getCost(name: string): import("./types.js").CostBreakdown;
    listAgents(cwd?: string): AgentInfo[];
    createAgent(name: string, cwd?: string, description?: string, prompt?: string): string;
    listSkills(cwd?: string): SkillInfo[];
    createSkill(name: string, cwd?: string, opts?: {
        description?: string;
        prompt?: string;
        trigger?: string;
    }): string;
    listRules(cwd?: string): RuleInfo[];
    createRule(name: string, cwd?: string, opts?: {
        description?: string;
        content?: string;
        paths?: string;
        condition?: string;
    }): string;
    teamList(name: string): Promise<string>;
    teamSend(name: string, teammate: string, message: string): Promise<SendResult>;
    /**
     * Returns an overview of all active sessions — analogous to a dashboard.
     * Unlike claude_session_status (single session), this gives the aggregate
     * view: how many sessions are running, which are busy, total uptime, etc.
     */
    health(): {
        ok: boolean;
        version: string;
        sessions: number;
        sessionNames: string[];
        uptime: number;
        details: Array<{
            name: string;
            ready: boolean;
            busy: boolean;
            paused: boolean;
            turns: number;
            costUsd: number;
            contextPercent: number;
            lastActivity: string | null;
        }>;
        circuitBreakers: Record<string, {
            failures: number;
            backoffUntil: string | null;
        }>;
    };
    /** Return plugin version from package.json */
    getVersion(): string;
    /**
     * Gracefully shut down the session manager.
     *
     * 1. Cancels the periodic TTL cleanup timer
     * 2. Stops all ultrareview polling intervals
     * 3. Sends SIGTERM to all active session child processes
     * 4. Persists final session registry to disk
     *
     * After shutdown(), no new sessions can be started. Idempotent.
     */
    shutdown(): Promise<void>;
    /**
     * Read OpenClaw gateway config from ~/.openclaw/openclaw.json.
     * Returns { url, key } or null if not configured.
     */
    private _readGatewayConfig;
    /**
     * Start a local proxy server (if not running) that converts Anthropic format
     * to OpenAI format and forwards to the OpenClaw gateway.
     * Returns the proxy port, or null if gateway is not available.
     */
    private _ensureProxyServer;
    private _persistSession;
    private static PID_FILE;
    private _savePids;
    /**
     * Verify that a PID belongs to a known coding CLI before killing it.
     * Prevents killing unrelated processes if the OS recycled the PID.
     */
    private _isKnownCliProcess;
    private _cleanupOrphanedPids;
    private _getSession;
    private _toSessionInfo;
    private _resolveModel;
    private _listMdFiles;
    private _createSession;
    private councils;
    private councilCleanupTimers;
    councilStart(task: string, config: CouncilConfig): CouncilSession;
    private _scheduleCouncilCleanup;
    councilStatus(id: string): CouncilSession | undefined;
    councilAbort(id: string): void;
    councilInject(id: string, message: string): void;
    councilReview(id: string): Promise<CouncilReviewResult>;
    councilAccept(id: string): Promise<CouncilAcceptResult>;
    councilReject(id: string, feedback: string): Promise<CouncilRejectResult>;
    private get _sessionLookup();
    sessionSendTo(from: string, to: string, message: string, summary?: string): Promise<{
        delivered: boolean;
        queued: boolean;
    }>;
    sessionInbox(name: string, unreadOnly?: boolean): InboxMessage[];
    sessionDeliverInbox(name: string): Promise<number>;
    private ultraplans;
    ultraplanStart(task: string, opts?: {
        model?: string;
        cwd?: string;
        timeout?: number;
    }): UltraplanResult;
    private _runUltraplan;
    ultraplanStatus(id: string): UltraplanResult | undefined;
    private ultrareviews;
    private ultrareviewPollers;
    ultrareviewStart(cwd: string, opts?: {
        agentCount?: number;
        maxDurationMinutes?: number;
        model?: string;
        focus?: string;
    }): UltrareviewResult;
    ultrareviewStatus(id: string): UltrareviewResult | undefined;
    private _cleanupIdleSessions;
}
export {};
