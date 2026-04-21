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
import { convertAnthropicToOpenAI, convertOpenAIToAnthropic, convertStreamOpenAIToAnthropic, } from './anthropic-adapter.js';
import { injectThoughtSigs } from './thought-cache.js';
import { resolveProvider } from '../models.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FETCH_TIMEOUT_MS } from '../constants.js';
/** Create an AbortSignal that fires after the given timeout */
function fetchSignal(ms = FETCH_TIMEOUT_MS) {
    return AbortSignal.timeout(ms);
}
// ─── Anthropic Base URL Resolution (3-layer fallback) ────────────────────────
// Layer 1: ANTHROPIC_BASE_URL env var (Claude Code convention)
// Layer 2: OpenClaw global config providers[name].baseUrl (cross-platform)
// Layer 3: Official Anthropic API fallback
const ANTHROPIC_DEFAULT = 'https://api.anthropic.com';
let _cachedBaseUrl;
function getAnthropicBaseUrl() {
    if (_cachedBaseUrl !== undefined)
        return _cachedBaseUrl;
    // Layer 1: env var (highest priority — Claude Code convention)
    if (process.env.ANTHROPIC_BASE_URL) {
        _cachedBaseUrl = process.env.ANTHROPIC_BASE_URL;
        return _cachedBaseUrl;
    }
    // Layer 2: OpenClaw global config (~/.openclaw/openclaw.json)
    try {
        const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf8');
            const cfg = JSON.parse(raw);
            const providers = cfg?.providers;
            if (providers && typeof providers === 'object') {
                for (const [, p] of Object.entries(providers)) {
                    if (p?.baseUrl) {
                        _cachedBaseUrl = p.baseUrl;
                        return _cachedBaseUrl;
                    }
                }
            }
        }
    }
    catch (err) {
        console.warn('[proxy] Failed to read OpenClaw config for base URL:', err.message);
    }
    // Layer 3: default
    _cachedBaseUrl = ANTHROPIC_DEFAULT;
    return _cachedBaseUrl;
}
// ─── Retry Logic ────────────────────────────────────────────────────────────
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;
async function fetchWithRetry(url, init, maxRetries = MAX_RETRIES) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const resp = await fetch(url, init);
            if (!RETRY_STATUS_CODES.has(resp.status) || attempt === maxRetries)
                return resp;
            // Check Retry-After header
            const retryAfter = resp.headers.get('retry-after');
            const delayMs = retryAfter
                ? Math.min(parseInt(retryAfter, 10) * 1000 || RETRY_BASE_DELAY_MS, 30_000)
                : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, delayMs));
        }
        catch (err) {
            lastError = err;
            if (attempt === maxRetries)
                throw lastError;
            await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
        }
    }
    throw lastError || new Error('Fetch failed after retries');
}
// ─── Extract Real Model from URL ─────────────────────────────────────────────
/**
 * Claude Code CLI passes the real model via URL path:
 *   /real/<model>/v1/messages
 *
 * Extract the model name from the URL (first segment after /real/).
 */
function extractRealModel(url) {
    const match = url.match(/\/real\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}
// ─── Handler ─────────────────────────────────────────────────────────────────
export function createProxyHandler(config, env) {
    /**
     * Main proxy handler — receives Anthropic-format request, returns Anthropic-format response.
     */
    return async function handleProxy(req, res) {
        // HEAD/GET probes from Claude Code CLI (no body) — respond 200
        if (req.method === 'HEAD' || req.method === 'GET') {
            res.status(200).json({ status: 'ok' });
            return true;
        }
        try {
            const body = (await req.json());
            // Determine real model from URL path or request body
            const urlModel = extractRealModel(req.url);
            const requestModel = urlModel || body.model;
            body.model = requestModel;
            const { provider, apiModel } = resolveProvider(requestModel);
            const isStream = body.stream ?? false;
            // ─── Direct Anthropic passthrough ─────────────────────────────
            if (provider === 'anthropic') {
                return await forwardToAnthropic(body, env, res, isStream);
            }
            // ─── Gateway passthrough ──────────────────────────────────────
            if (env.gatewayUrl && env.gatewayKey) {
                return await forwardToGateway(body, apiModel, env, res, isStream, requestModel);
            }
            // ─── Direct provider via format conversion ────────────────────
            const openaiReq = convertAnthropicToOpenAI(body);
            openaiReq.model = apiModel;
            // Inject thought signatures for Gemini round-trip
            if (provider === 'google') {
                injectThoughtSigs(openaiReq.messages);
            }
            // Determine API endpoint and key
            let apiUrl;
            let apiKey;
            if (provider === 'google') {
                apiUrl = 'https://generativelanguage.googleapis.com/v1beta/chat/completions';
                apiKey = env.geminiApiKey || '';
            }
            else {
                apiUrl = 'https://api.openai.com/v1/chat/completions';
                apiKey = env.openaiApiKey || '';
            }
            if (!apiKey) {
                res.status(401).json({ error: `No API key configured for provider: ${provider}` });
                return true;
            }
            if (isStream) {
                return await handleStreamingResponse(apiUrl, apiKey, openaiReq, res, requestModel);
            }
            else {
                return await handleNonStreamingResponse(apiUrl, apiKey, openaiReq, res, requestModel);
            }
        }
        catch (err) {
            console.error('[proxy] Error:', err.message);
            const message = err.name === 'TimeoutError' ? 'Upstream request timed out' : 'Internal proxy error';
            res.status(500).json({
                type: 'error',
                error: { type: 'server_error', message },
            });
            return true;
        }
    };
}
// ─── Anthropic Passthrough ───────────────────────────────────────────────────
async function forwardToAnthropic(body, env, res, isStream) {
    const apiKey = env.anthropicApiKey;
    if (!apiKey) {
        res.status(401).json({ error: 'No ANTHROPIC_API_KEY configured' });
        return true;
    }
    const fetchInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: fetchSignal(),
    };
    const baseUrl = getAnthropicBaseUrl();
    if (isStream) {
        const resp = await fetch(`${baseUrl}/v1/messages`, fetchInit);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.flushHeaders?.();
        const reader = resp.body?.getReader();
        if (reader) {
            const decoder = new TextDecoder();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    res.write(decoder.decode(value, { stream: true }));
                }
            }
            finally {
                reader.cancel().catch(() => { });
            }
        }
        res.end();
    }
    else {
        const resp = await fetchWithRetry(`${baseUrl}/v1/messages`, fetchInit);
        const data = await resp.json();
        res.status(resp.status).json(data);
    }
    return true;
}
// ─── Gateway Passthrough ─────────────────────────────────────────────────────
async function forwardToGateway(body, apiModel, env, res, isStream, originalModel) {
    const openaiReq = convertAnthropicToOpenAI(body);
    // OpenClaw gateway requires model="openclaw" or "openclaw/<agentId>"
    openaiReq.model = apiModel.startsWith('openclaw') ? apiModel : 'openclaw';
    // Inject thought signatures for Gemini
    injectThoughtSigs(openaiReq.messages);
    const gatewayInit = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.gatewayKey}`,
            'x-openclaw-agent-id': 'claude-code-raw',
        },
        body: JSON.stringify(openaiReq),
        signal: fetchSignal(),
    };
    if (isStream) {
        const resp = await fetch(`${env.gatewayUrl}/chat/completions`, gatewayInit);
        if (!resp.ok) {
            const err = await resp.text();
            console.error('[proxy] Gateway error:', resp.status, err);
            res
                .status(resp.status)
                .json({ type: 'error', error: { type: 'gateway_error', message: 'Upstream gateway error' } });
            return true;
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.flushHeaders?.();
        const reader = resp.body?.getReader();
        if (!reader) {
            res.end();
            return true;
        }
        try {
            const lineStream = readSSELines(reader);
            for await (const sseChunk of convertStreamOpenAIToAnthropic(lineStream, originalModel)) {
                res.write(sseChunk);
            }
        }
        finally {
            reader.cancel().catch(() => { });
        }
        res.end();
    }
    else {
        const resp = await fetchWithRetry(`${env.gatewayUrl}/chat/completions`, gatewayInit);
        if (!resp.ok) {
            const err = await resp.text();
            console.error('[proxy] Gateway error:', resp.status, err);
            res
                .status(resp.status)
                .json({ type: 'error', error: { type: 'gateway_error', message: 'Upstream gateway error' } });
            return true;
        }
        const data = (await resp.json());
        const anthropicResp = convertOpenAIToAnthropic(data, originalModel);
        res.status(200).json(anthropicResp);
    }
    return true;
}
// ─── Direct Provider ─────────────────────────────────────────────────────────
async function handleNonStreamingResponse(apiUrl, apiKey, openaiReq, res, originalModel) {
    const resp = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(Object.assign({}, openaiReq, { stream: false })),
        signal: fetchSignal(),
    });
    if (!resp.ok) {
        const err = await resp.text();
        console.error('[proxy] API error:', resp.status, err);
        res.status(resp.status).json({ type: 'error', error: { type: 'api_error', message: 'Upstream API error' } });
        return true;
    }
    const data = (await resp.json());
    const anthropicResp = convertOpenAIToAnthropic(data, originalModel);
    res.status(200).json(anthropicResp);
    return true;
}
async function handleStreamingResponse(apiUrl, apiKey, openaiReq, res, originalModel) {
    const resp = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(Object.assign({}, openaiReq, { stream: true })),
        signal: fetchSignal(),
    }, 1);
    if (!resp.ok) {
        const err = await resp.text();
        console.error('[proxy] Streaming API error:', resp.status, err);
        res.status(resp.status).json({ type: 'error', error: { type: 'api_error', message: 'Upstream API error' } });
        return true;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders?.();
    const reader = resp.body?.getReader();
    if (!reader) {
        res.end();
        return true;
    }
    const heartbeat = setInterval(() => {
        try {
            res.write(':keepalive\n\n');
        }
        catch {
            /* client gone */
        }
    }, 15_000);
    try {
        const lineStream = readSSELines(reader);
        for await (const sseChunk of convertStreamOpenAIToAnthropic(lineStream, originalModel)) {
            res.write(sseChunk);
        }
    }
    finally {
        clearInterval(heartbeat);
        reader.cancel().catch(() => { });
    }
    res.end();
    return true;
}
// ─── SSE Line Reader ─────────────────────────────────────────────────────────
async function* readSSELines(reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed)
                yield trimmed;
        }
    }
    if (buffer.trim())
        yield buffer.trim();
}
//# sourceMappingURL=handler.js.map