/**
 * Proxy HTTP Handler — registerHttpRoute handler for OpenClaw Plugin SDK
 *
 * Receives Anthropic-format requests from Claude Code CLI,
 * translates to OpenAI format, forwards to the target provider,
 * and translates the response back to Anthropic format.
 *
 * Supports:
 * - Direct Anthropic API passthrough (zero conversion)
 * - OpenAI/GPT models via format conversion
 * - Gemini models via format conversion + schema cleaning
 * - Gateway passthrough (OpenClaw gateway handles routing)
 * - Streaming and non-streaming modes
 */
import type { ProxyConfig } from '../types.js';
export interface ProxyEnv {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    geminiApiKey?: string;
    gatewayUrl?: string;
    gatewayKey?: string;
}
interface HttpRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
    json(): Promise<unknown>;
}
interface HttpResponse {
    status(code: number): HttpResponse;
    json(data: unknown): void;
    setHeader(key: string, value: string): void;
    write(data: string): void;
    end(): void;
    flushHeaders?(): void;
}
export declare function createProxyHandler(config: ProxyConfig | undefined, env: ProxyEnv): (req: HttpRequest, res: HttpResponse) => Promise<boolean>;
export {};
