/**
 * OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Bridges OpenAI API format to persistent Claude Code sessions, enabling
 * webchat frontends (ChatGPT-Next-Web, Open WebUI, etc.) to use the plugin
 * as a drop-in backend. Stateful sessions maximize Anthropic prompt caching.
 */
import * as http from 'node:http';
export interface OpenAIChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{
        type?: string;
        text?: string;
    }> | null;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    tool_call_id?: string;
}
export interface OpenAIChatCompletionRequest {
    model?: string;
    messages: OpenAIChatMessage[];
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    user?: string;
    tools?: Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: unknown;
        };
    }>;
}
export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface OpenAIChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: OpenAIToolCall[];
        };
        finish_reason: 'stop' | 'length' | 'tool_calls';
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export interface OpenAIChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string | null;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: 'function';
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason: string | null;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
/**
 * Derive a session key from the request.
 * Priority: X-Session-Id header > user field > sha1(model + systemPrompt) > "default"
 *
 * The system-prompt-hash fallback prevents the bug where every caller without
 * X-Session-Id or `user` collapses onto a single shared "openai-default"
 * plugin session. In multi-caller setups (OpenClaw routing the main agent,
 * cron jobs, and subagents through the same gateway) that previously meant
 * every request serialized against every other and frequently picked up the
 * wrong session's appendSystemPrompt — also a privacy leak across callers.
 *
 * The model is mixed into the hash so that two callers with the same system
 * prompt but different requested models don't collide and silently get
 * responses from the wrong model. Originally diagnosed in PR #40 by
 * @megayounus786.
 */
/**
 * When set (to '1', 'true', 'yes'), the proxy preserves the pre-fix behavior:
 *   - tools injected into every user message
 *   - session key NOT fingerprinted by tools (same session across tool changes)
 * Default (unset) is the new behavior: tools embedded in session system prompt
 * at create time + session key fingerprinted by tools. The new behavior
 * eliminates periodic latency spikes but does not support mutating the tool
 * list within a single session (a new session is created when tools change).
 */
export declare function isToolsPerMessageModeEnabled(): boolean;
/**
 * Generate the "no built-in tools" system prompt preamble.
 * The `toolLocation` parameter controls how the model is told where to find
 * tool definitions — 'system' means "in the <available_tools> block below"
 * (tools baked into system prompt), 'user' means "in <available_tools> tags
 * in the user message" (legacy per-turn injection).
 */
export declare function noToolsSystemPrompt(toolLocation: 'system' | 'user'): string;
/**
 * Build the full session system prompt for a Claude Code session with tools.
 * Exported for testability — called from `handleChatCompletion`.
 *
 * - Default mode: tools are embedded in the system prompt (cacheable by Anthropic).
 * - Legacy mode (OPENAI_COMPAT_TOOLS_PER_MESSAGE=1): tools are NOT embedded;
 *   they'll be injected per-turn in the user message instead.
 */
export declare function buildSessionSystemPrompt(tools: OpenAIChatCompletionRequest['tools'], callerSystemPrompt: string | undefined): string;
export declare function resolveSessionKey(body: OpenAIChatCompletionRequest, headers: http.IncomingHttpHeaders): string;
/** Build the full session name from a key */
export declare function sessionNameFromKey(key: string): string;
/**
 * Convert OpenAI tool definitions into a structured prompt block.
 * Injected into the user message so the CLI model sees tool definitions
 * and responds with <tool_calls> tags when it wants to invoke a function.
 */
export declare function buildToolPromptBlock(tools: OpenAIChatCompletionRequest['tools']): string;
export interface ParsedToolCalls {
    textContent: string | null;
    toolCalls: OpenAIToolCall[];
}
/**
 * Parse tool_calls from CLI text output.
 *
 * Looks for <tool_calls>[...]</tool_calls> tags in the response text.
 * Returns both the extracted text content (before/after tags) and any tool calls found.
 */
export declare function parseToolCallsFromText(text: string): ParsedToolCalls;
/**
 * Serialize tool result messages into a text block for the CLI model.
 * Converts OpenAI `tool` role messages into <tool_result> tags.
 */
export declare function serializeToolResults(messages: OpenAIChatMessage[]): string;
export interface ExtractedMessage {
    systemPrompt: string | undefined;
    userMessage: string;
    isNewConversation: boolean;
}
/**
 * Extract the relevant parts from an OpenAI messages array.
 *
 * Sessions are stateful — we only need the last user message. The tricky
 * question is whether to start a fresh session or append to the existing one.
 *
 * Default mode (no env var): only honor an explicit `X-Session-Reset: 1`
 * header. This is correct for clients that maintain their own conversation
 * transcript and forward only the latest user turn (OpenClaw main agent
 * loop, cron jobs, subagents). The previous heuristic
 * (`nonSystemMessages.length <= 1`) fired on every such request, killing the
 * persistent CLI every turn and preventing Anthropic prompt caching from
 * ever warming. Originally diagnosed in PR #40 by @megayounus786.
 *
 * Legacy mode (`OPENAI_COMPAT_NEW_CONVO_HEURISTIC=1`): restore the old
 * `system + single user ⇒ new conversation` rule, for clients that re-send
 * the full transcript on every turn (ChatGPT-Next-Web, Open WebUI, data
 * labeling tools, etc). They use the transcript shape itself as their only
 * "start a new conversation" signal.
 *
 * The env var is read on every call so ops can flip it via launchctl setenv
 * without restarting the server.
 */
export declare function extractUserMessage(messages: OpenAIChatMessage[], headers?: Record<string, string | string[] | undefined>): ExtractedMessage;
export declare function formatCompletionResponse(id: string, model: string, text: string, tokensIn: number, tokensOut: number, toolCalls?: OpenAIToolCall[]): OpenAIChatCompletionResponse;
export declare function formatCompletionChunk(id: string, model: string, delta: {
    role?: string;
    content?: string;
}, finishReason: string | null): OpenAIChatCompletionChunk;
/** SessionManager-like interface to avoid circular imports */
interface SessionManagerLike {
    startSession(config: Record<string, unknown>): Promise<{
        name: string;
    }>;
    sendMessage(name: string, message: string, options?: Record<string, unknown>): Promise<{
        output: string;
        sessionId?: string;
        events: unknown[];
    }>;
    stopSession(name: string): Promise<void>;
    listSessions(): Array<{
        name: string;
    }>;
    getStatus(name: string): {
        stats: {
            tokensIn: number;
            tokensOut: number;
            contextPercent: number;
        };
    };
    compactSession(name: string): Promise<unknown>;
}
export declare function handleChatCompletion(manager: SessionManagerLike, body: Record<string, unknown>, headers: http.IncomingHttpHeaders, res: http.ServerResponse): Promise<void>;
export {};
