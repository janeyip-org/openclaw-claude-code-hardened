/**
 * Persistent Codex Session — wraps OpenAI `codex` CLI
 *
 * Unlike Claude Code, Codex does not maintain a persistent subprocess with
 * streaming JSON I/O.  Each send() spawns a new `codex` process in quiet +
 * full-auto mode.  The "session" is persistent in the sense that:
 *   - Working directory (cwd) carries accumulated code changes across sends
 *   - Stats, history, and cost are tracked continuously
 *   - The session has consistent lifecycle semantics (start/stop/pause/resume)
 */
import type { SessionConfig, SessionSendOptions, TurnResult } from './types.js';
import { BaseOneShotSession } from './base-oneshot-session.js';
export declare class PersistentCodexSession extends BaseOneShotSession {
    constructor(config: SessionConfig, codexBin?: string);
    protected _run(message: string, options: SessionSendOptions): Promise<TurnResult>;
}
