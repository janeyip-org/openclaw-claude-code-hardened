/**
 * Structured logging interface with level control.
 *
 * Default implementation logs to console, filtered by OPENCLAW_LOG_LEVEL env var.
 * Valid levels: debug, info, warn, error. Default: info.
 */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
function parseLevel(envVal) {
    if (envVal && envVal in LEVELS)
        return envVal;
    return 'info';
}
/** Create a console-backed logger with optional prefix and env-var level control. */
export function createConsoleLogger(prefix) {
    const level = parseLevel(process.env.OPENCLAW_LOG_LEVEL);
    const threshold = LEVELS[level];
    const pfx = prefix ? `[${prefix}] ` : '';
    return {
        debug: (msg, ...args) => {
            if (threshold <= LEVELS.debug)
                console.log(`${pfx}${msg}`, ...args);
        },
        info: (msg, ...args) => {
            if (threshold <= LEVELS.info)
                console.log(`${pfx}${msg}`, ...args);
        },
        warn: (msg, ...args) => {
            if (threshold <= LEVELS.warn)
                console.warn(`${pfx}${msg}`, ...args);
        },
        error: (msg, ...args) => {
            if (threshold <= LEVELS.error)
                console.error(`${pfx}${msg}`, ...args);
        },
    };
}
/** No-op logger — useful in tests to suppress output. */
export const nullLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
//# sourceMappingURL=logger.js.map