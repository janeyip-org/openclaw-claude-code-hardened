/**
 * openclaw-claude-code — Plugin entry point
 *
 * Registers tools, hooks, and HTTP routes with the OpenClaw Plugin SDK.
 * When used standalone (no OpenClaw), exports SessionManager for direct use.
 *
 * Lazy initialisation: SessionManager and EmbeddedServer are created only on
 * the first tool call. While the plugin is registered but never used, it
 * consumes no memory beyond the tool schema definitions.
 */
export { SessionManager } from './session-manager.js';
export { PersistentClaudeSession } from './persistent-session.js';
export { BaseOneShotSession, type OneShotEngineConfig } from './base-oneshot-session.js';
export { PersistentCodexSession } from './persistent-codex-session.js';
export { PersistentGeminiSession } from './persistent-gemini-session.js';
export { PersistentCursorSession } from './persistent-cursor-session.js';
export { PersistentCustomSession } from './persistent-custom-session.js';
export { Council, getDefaultCouncilConfig } from './council.js';
export { parseConsensus, stripConsensusTags, hasConsensusMarker } from './consensus.js';
export { sanitizeCwd, validateRegex, validateName } from './validation.js';
export { type Logger, createConsoleLogger, nullLogger } from './logger.js';
export { CircuitBreaker } from './circuit-breaker.js';
export { InboxManager, type SessionLookup } from './inbox-manager.js';
export type { ISession } from './types.js';
export * from './types.js';
/** OpenClaw Plugin SDK interface (minimal typing for what we use) */
interface PluginAPI {
    pluginConfig: Record<string, unknown>;
    logger: {
        info(...args: unknown[]): void;
        error(...args: unknown[]): void;
        warn(...args: unknown[]): void;
    };
    registerTool(def: {
        name: string;
        label?: string;
        description: string;
        parameters: Record<string, unknown>;
        execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
    }): void;
    on(event: string, handler: (event: Record<string, unknown>, ctx?: unknown) => Promise<void>): void;
    registerHttpRoute(def: {
        path: string;
        auth?: string;
        match?: string;
        handler: (...args: unknown[]) => Promise<boolean>;
    }): void;
    registerService(def: {
        id: string;
        start: () => void;
        stop: () => void;
    }): void;
}
/**
 * OpenClaw plugin object — standard format
 */
declare const plugin: {
    id: string;
    name: string;
    description: string;
    register(api: PluginAPI): void;
};
export default plugin;
