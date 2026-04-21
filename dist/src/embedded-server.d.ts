/**
 * Embedded HTTP Server — auto-starts with plugin, serves CLI commands
 *
 * This is NOT a separate process. It runs inside the plugin (or standalone)
 * and provides HTTP endpoints for the CLI to connect to.
 *
 * Users never need to configure or manage this — it just works.
 */
import { SessionManager } from './session-manager.js';
export declare class EmbeddedServer {
    private server;
    private manager;
    private port;
    private authToken;
    private _rateWindows;
    private _rateLimitCleanupTimer;
    private _rateLimit;
    private host;
    constructor(manager: SessionManager, port?: number, host?: string);
    private _checkRateLimit;
    start(): Promise<number>;
    stop(): Promise<void>;
    private handleRequest;
    private route;
}
