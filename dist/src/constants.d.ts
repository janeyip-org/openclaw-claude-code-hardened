/**
 * Shared constants — consolidates magic numbers scattered across the codebase.
 *
 * Grouped by domain. Import what you need rather than using inline numbers.
 */
/** Token threshold that triggers the onContextHigh hook */
export declare const CONTEXT_HIGH_THRESHOLD = 140000;
/** Max history entries kept in memory per session (oldest evicted via shift) */
export declare const MAX_HISTORY_ITEMS = 100;
/** Default number of history entries returned by getHistory() */
export declare const DEFAULT_HISTORY_LIMIT = 50;
/** Number of history entries fetched for grep operations */
export declare const GREP_HISTORY_FETCH = 500;
/** Wait for session init/ready event after spawn */
export declare const SESSION_READY_TIMEOUT_MS = 30000;
/** Fallback delay before checking if proc is alive (resume path) */
export declare const SESSION_READY_FALLBACK_MS = 2000;
/** Default timeout for a send() / turn completion */
export declare const TURN_TIMEOUT_MS = 300000;
/** Timeout for compact / context summary operations */
export declare const COMPACT_TIMEOUT_MS = 60000;
/** Delay before SIGKILL after initial SIGTERM on stop() */
export declare const STOP_SIGKILL_DELAY_MS = 3000;
/** Timeout for most git CLI operations (branch, checkout, log, diff) */
export declare const GIT_CMD_TIMEOUT_MS = 5000;
/** Timeout for git worktree add/remove (heavier operations) */
export declare const WORKTREE_CMD_TIMEOUT_MS = 10000;
/** Default per-agent timeout in council */
export declare const DEFAULT_AGENT_TIMEOUT_MS = 1800000;
/** Delay between council rounds */
export declare const INTER_ROUND_DELAY_MS = 3000;
/** Delay before retrying on empty agent response */
export declare const EMPTY_RESPONSE_RETRY_DELAY_MS = 5000;
/** Timeout for council follow-up prompts */
export declare const FOLLOWUP_TIMEOUT_MS = 60000;
/** Timeout for team list operations */
export declare const TEAM_LIST_TIMEOUT_MS = 30000;
/** Timeout for team send operations */
export declare const TEAM_SEND_TIMEOUT_MS = 120000;
/** Timeout for ultraplan sessions */
export declare const ULTRAPLAN_TIMEOUT_MS = 1800000;
/** How long completed results remain queryable */
export declare const RESULT_TTL_MS = 1800000;
/** Session TTL cleanup check interval */
export declare const CLEANUP_INTERVAL_MS = 60000;
/** Debounce delay for persisted session writes */
export declare const DEBOUNCED_SAVE_MS = 5000;
/** Persisted sessions disk TTL (7 days) */
export declare const PERSIST_DISK_TTL_MS: number;
/** Fetch timeout for proxy forward requests */
export declare const FETCH_TIMEOUT_MS = 600000;
/** Ultrareview polling interval */
export declare const ULTRAREVIEW_POLL_INTERVAL_MS = 5000;
/** Default port for the embedded HTTP server */
export declare const DEFAULT_SERVER_PORT = 18796;
/** Maximum request body size (5 MB) */
export declare const MAX_BODY_SIZE = 5242880;
/** Rate limit: max requests per window per IP */
export declare const RATE_LIMIT_MAX_REQUESTS = 300;
/** Rate limit: sliding window duration */
export declare const RATE_LIMIT_WINDOW_MS = 60000;
/** Minimum task description length */
export declare const MIN_TASK_LENGTH = 5;
/** Max retries for empty agent responses */
export declare const EMPTY_RESPONSE_MAX_RETRIES = 2;
/** Minimum response length to consider complete */
export declare const MIN_COMPLETE_RESPONSE_LENGTH = 100;
/** Max follow-up retries per agent */
export declare const FOLLOWUP_MAX_RETRIES = 2;
/** Character limit for history preview in council prompts */
export declare const HISTORY_PREVIEW_CHARS = 1500;
/** Character limit for agent summary in review */
export declare const SUMMARY_PREVIEW_CHARS = 500;
/** Character limit for short summary in transcript */
export declare const SUMMARY_SHORT_CHARS = 400;
/** Character limit for compact context */
export declare const COMPACT_CONTEXT_CHARS = 300;
/** Default max rounds in council collaboration */
export declare const DEFAULT_MAX_ROUNDS = 15;
/** Default max turns per agent */
export declare const DEFAULT_MAX_TURNS_PER_AGENT = 50;
/** Git log depth for council review */
export declare const GIT_LOG_DEPTH = 50;
/** Max messages per session inbox */
export declare const MAX_INBOX_SIZE = 200;
/** Consecutive failures before circuit opens */
export declare const CIRCUIT_BREAKER_THRESHOLD = 3;
/** Base backoff delay (doubles each failure) */
export declare const CIRCUIT_BREAKER_BACKOFF_BASE_MS = 1000;
/** Maximum backoff duration cap */
export declare const CIRCUIT_BREAKER_MAX_BACKOFF_MS = 300000;
export declare const SESSION_EVENT: {
    readonly READY: "ready";
    readonly INIT: "init";
    readonly TEXT: "text";
    readonly TOOL_USE: "tool_use";
    readonly TOOL_RESULT: "tool_result";
    readonly RESULT: "result";
    readonly TURN_COMPLETE: "turn_complete";
    readonly ERROR: "error";
    readonly LOG: "log";
    readonly CLOSE: "close";
    readonly PAUSED: "paused";
    readonly RESUMED: "resumed";
    readonly SYSTEM: "system";
    readonly API_RETRY: "api_retry";
    readonly STREAM_EVENT: "stream_event";
    readonly USER_ECHO: "user_echo";
    readonly ASSISTANT: "assistant";
    readonly EVENT: "event";
};
export type SessionEventName = (typeof SESSION_EVENT)[keyof typeof SESSION_EVENT];
/** Default model when the OpenAI-compat request omits `model` */
export declare const OPENAI_COMPAT_DEFAULT_MODEL = "claude-sonnet-4-6";
/** Context utilization % threshold for auto-compact */
export declare const OPENAI_COMPAT_AUTO_COMPACT_THRESHOLD = 80;
/** Session name prefix for OpenAI-compat sessions */
export declare const OPENAI_COMPAT_SESSION_PREFIX = "openai-";
/**
 * Default for the legacy new-conversation heuristic gate.
 *
 * When env var `OPENAI_COMPAT_NEW_CONVO_HEURISTIC=1` is set, the old
 * "system + single user ⇒ new conversation" rule is restored for webchat
 * frontends (ChatGPT-Next-Web, Open WebUI, etc) that re-send the full
 * transcript every turn. Default off: assumes upstream clients forward
 * only the latest turn (OpenClaw main agent loop, cron jobs, subagents).
 *
 * The constant exists as a documentation anchor; openai-compat.ts reads
 * the env var directly so the value can be flipped without restart.
 */
export declare const OPENAI_COMPAT_NEW_CONVO_HEURISTIC_DEFAULT = false;
