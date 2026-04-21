/**
 * Persistent Gemini Session — wraps Google `gemini` CLI
 *
 * Like Codex, each send() spawns a new `gemini` process. Unlike Codex,
 * Gemini CLI supports `--output-format stream-json` which provides real
 * token usage data and structured tool call events instead of raw text.
 *
 * The "session" is persistent in the same sense as Codex:
 *   - Working directory carries accumulated code changes across sends
 *   - Stats, history, and cost are tracked continuously
 *   - Consistent lifecycle semantics (start/stop/pause/resume)
 */
import type { SessionConfig, SessionSendOptions, TurnResult } from './types.js';
import { BaseOneShotSession } from './base-oneshot-session.js';
export declare class PersistentGeminiSession extends BaseOneShotSession {
    private _currentRl;
    constructor(config: SessionConfig, geminiBin?: string);
    protected _cleanupProc(): void;
    protected _run(message: string, options: SessionSendOptions): Promise<TurnResult>;
    private _handleStreamEvent;
}
