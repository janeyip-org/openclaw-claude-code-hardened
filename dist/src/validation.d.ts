/**
 * Shared validation utilities for input sanitization.
 *
 * Used by both the plugin tool handlers (index.ts) and the embedded HTTP
 * server (embedded-server.ts) to ensure consistent protection regardless
 * of entry point.
 */
/**
 * Resolve and validate a working directory path.
 *
 * Prevents path traversal and blocks access to system-critical and
 * sensitive directories. Resolves symlinks where possible to defeat
 * symlink-based bypasses.
 */
export declare function sanitizeCwd(cwd: string | undefined): string | undefined;
/**
 * Validate that a string is a syntactically valid regular expression.
 *
 * Returns the compiled RegExp if valid, throws on invalid syntax.
 * Note: this validates syntax only — it does not detect catastrophic
 * backtracking (ReDoS) patterns.
 */
export declare function validateRegex(pattern: string): RegExp;
/**
 * Validate a resource name (agent, skill, rule) to prevent path injection.
 *
 * Only allows alphanumeric characters, hyphens, and underscores.
 * Rejects empty strings, dots, slashes, spaces, and any other characters
 * that could be used for path traversal.
 */
export declare function validateName(name: string): string;
