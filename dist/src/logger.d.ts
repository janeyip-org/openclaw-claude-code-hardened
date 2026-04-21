/**
 * Structured logging interface with level control.
 *
 * Default implementation logs to console, filtered by OPENCLAW_LOG_LEVEL env var.
 * Valid levels: debug, info, warn, error. Default: info.
 */
export interface Logger {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
}
/** Create a console-backed logger with optional prefix and env-var level control. */
export declare function createConsoleLogger(prefix?: string): Logger;
/** No-op logger — useful in tests to suppress output. */
export declare const nullLogger: Logger;
