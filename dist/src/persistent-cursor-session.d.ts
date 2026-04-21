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
import type { SessionConfig, SessionSendOptions, TurnResult } from './types.js';
import { BaseOneShotSession } from './base-oneshot-session.js';
export declare class PersistentCursorSession extends BaseOneShotSession {
    private _currentRl;
    constructor(config: SessionConfig, cursorBin?: string);
    protected _cleanupProc(): void;
    protected _run(message: string, options: SessionSendOptions): Promise<TurnResult>;
    private _handleStreamEvent;
}
