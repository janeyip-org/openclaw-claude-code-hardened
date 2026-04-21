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

import { spawn } from 'node:child_process';

import type { SessionConfig, SessionSendOptions, StreamEvent, TurnResult } from './types.js';
import { estimateTokens } from './models.js';
import { SESSION_EVENT } from './constants.js';
import { BaseOneShotSession } from './base-oneshot-session.js';

// ─── PersistentCodexSession ─────────────────────────────────────────────────

export class PersistentCodexSession extends BaseOneShotSession {
  constructor(config: SessionConfig, codexBin?: string) {
    super(config, codexBin || process.env.CODEX_BIN || 'codex', {
      enginePrefix: 'codex',
      defaultModel: 'o4-mini',
      supportsCachedTokens: false,
      engineDisplayName: 'Codex',
    });
  }

  protected _run(message: string, options: SessionSendOptions): Promise<TurnResult> {
    // Use `codex exec` for non-interactive execution (main `codex` requires TTY)
    const args: string[] = ['exec', '--full-auto', '--skip-git-repo-check'];

    if (this.options.model) args.push('--model', this.options.model);
    if (this.options.cwd) args.push('-C', this.options.cwd);
    args.push(message);

    const timeout = options.timeout || 300_000;

    return new Promise<TurnResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const proc = spawn(this.engineBin, args, {
        cwd: this.options.cwd,
        // SECURITY FIX: allowlist env vars instead of inheriting all
        env: {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME,
          USER: process.env.USER,
          SHELL: process.env.SHELL,
          LANG: process.env.LANG,
          TERM: process.env.TERM || 'xterm-256color',
          TMPDIR: process.env.TMPDIR,
          XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
          XDG_DATA_HOME: process.env.XDG_DATA_HOME,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
          HTTP_PROXY: process.env.HTTP_PROXY,
          HTTPS_PROXY: process.env.HTTPS_PROXY,
          NO_PROXY: process.env.NO_PROXY,
          NODE_ENV: process.env.NODE_ENV,
        },
        stdio: ['ignore', 'pipe', 'pipe'], // stdin must be 'ignore' — codex waits for piped stdin
      });
      this.currentProc = proc;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGTERM');
          reject(new Error('Timeout waiting for Codex response'));
        }
      }, timeout);

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        try {
          options.callbacks?.onText?.(chunk);
        } catch {
          // User callback error — swallow
        }
        this.emit(SESSION_EVENT.TEXT, chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        this.emit(SESSION_EVENT.LOG, `[codex-stderr] ${data.toString()}`);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.currentProc = null;

        if (settled) return;
        settled = true;

        this._recordTurnComplete();

        // Rough token estimate: ~1 token per 4 chars.
        // TODO(codex-cli): Replace with actual usage data when codex gains --usage output.
        const estimatedOutputTokens = estimateTokens(stdout);
        const estimatedInputTokens = estimateTokens(message);
        this._stats.tokensIn += estimatedInputTokens;
        this._stats.tokensOut += estimatedOutputTokens;
        this._updateCost();
        this._addHistory({ text: stdout, code });

        const event: StreamEvent = {
          type: 'result',
          result: stdout,
          stop_reason: code === 0 ? 'end_turn' : 'error',
        };

        this.emit(SESSION_EVENT.RESULT, event);
        this.emit(SESSION_EVENT.TURN_COMPLETE, event);

        if (code !== 0) {
          reject(new Error(stderr || `Codex exited with code ${code}`));
        } else {
          resolve({ text: stdout, event });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }
}
