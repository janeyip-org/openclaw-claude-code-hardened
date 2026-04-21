/**
 * Anthropic ↔ OpenAI Format Adapter
 *
 * Core conversion logic for translating between Anthropic Messages API format
 * and OpenAI Chat Completions format. Replaces the Python server.py (~2300 lines)
 * with pure TypeScript (~600 lines), no litellm dependency.
 *
 * Handles:
 * - Message format conversion (content blocks ↔ role/content strings)
 * - Tool schema conversion (Anthropic tools ↔ OpenAI function tools)
 * - Message normalization (re-interleave merged blocks for OpenAI)
 * - Response conversion (OpenAI response → Anthropic response)
 * - Streaming SSE conversion (OpenAI SSE → Anthropic SSE events)
 */
import { isGeminiModel, isClaudeModel } from '../models.js';
export interface AnthropicRequest {
    model: string;
    max_tokens: number;
    messages: AnthropicMessage[];
    system?: string | Array<{
        type: string;
        text: string;
    }>;
    tools?: AnthropicTool[];
    tool_choice?: {
        type: string;
        name?: string;
    };
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    thinking?: {
        type: string;
        budget_tokens?: number;
    };
}
export interface AnthropicMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | AnthropicContentBlock[];
}
export interface AnthropicContentBlock {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
    tool_use_id?: string;
    content?: unknown;
    [key: string]: unknown;
}
export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
}
export interface AnthropicResponse {
    id: string;
    type: 'message';
    model: string;
    role: 'assistant';
    content: AnthropicContentBlock[];
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number;
        cache_read_input_tokens: number;
    };
}
export interface OpenAIRequest {
    model: string;
    messages: OpenAIMessage[];
    max_completion_tokens?: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
    tools?: OpenAITool[];
    tool_choice?: string | {
        type: string;
        function: {
            name: string;
        };
    };
    thinking?: {
        type: string;
        budget_tokens?: number;
    };
}
export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
}
export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
    extra_content?: Record<string, unknown>;
}
export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
export interface OpenAIResponse {
    id?: string;
    model?: string;
    choices: Array<{
        message?: {
            content?: string | null;
            tool_calls?: OpenAIToolCall[];
        };
        finish_reason?: string;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
    };
}
export { isGeminiModel, isClaudeModel };
export declare function convertAnthropicToOpenAI(req: AnthropicRequest): OpenAIRequest;
export declare function convertOpenAIToAnthropic(resp: OpenAIResponse, originalModel: string): AnthropicResponse;
/**
 * Convert an OpenAI SSE stream to Anthropic SSE format.
 * Yields Anthropic-formatted SSE strings.
 */
export declare function convertStreamOpenAIToAnthropic(stream: AsyncIterable<string>, originalModel: string): AsyncGenerator<string>;
