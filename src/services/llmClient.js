/**
 * src/services/llmClient.js
 * Minimal LLM client, routed to the provider configured in the config store
 * (no new dependencies — global fetch only).
 *
 * Routing (provider names from `decode init`):
 *  - anthropic  → POST {base}/v1/messages    (x-api-key + anthropic-version headers)
 *  - openai     → POST {base}/v1/chat/completions (Bearer)
 *  - groq/other → POST {base}/v1/chat/completions (Bearer) — "other" defaults
 *                 to the OpenAI-compatible shape (common for most providers).
 *
 * The base URL comes from the LLM_PROVIDER_BASE_URL env var if set, else a
 * per-provider default. `fetchImpl` is injectable for hermetic tests.
 *
 * No data is ever fabricated (AGENTS.md rule 9): when no provider/key is
 * configured this throws a clear error that callers can degrade gracefully.
 */
import { ENV_LLM_KEY, readConfig, readEnv } from './configStore.js';

const PROVIDER_BASE_URLS = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  // Groq's OpenAI-compatible root is https://api.groq.com/openai — the CLI
  // appends /v1/chat/completions below, so this MUST keep the `/openai`
  // segment. Omitting it produces https://api.groq.com/v1/... which 404s.
  groq: 'https://api.groq.com/openai',
};

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o-mini',
  // Verified live on Groq's production model list (2026-08): llama-3.1-8b-instant.
  groq: 'llama-3.1-8b-instant',
  other: 'gpt-4o-mini',
};

const MAX_TOKENS = 512;

/**
 * @returns {{ provider: string|null, apiKey: string|null }} connection info
 * read fresh from the config store + .env.
 */
function getLlmConnection({ cwd } = {}) {
  const config = readConfig({ cwd });
  const env = readEnv({ cwd });
  return {
    provider: config.llm.provider,
    apiKey: env[ENV_LLM_KEY] || null,
  };
}

export function isLlmConfigured(opts = {}) {
  const { provider, apiKey } = getLlmConnection(opts);
  return Boolean(provider && apiKey);
}

/**
 * Builds the OpenAI-compatible chat completions endpoint from a base URL.
 * Handles bases that already end in `/v1` (e.g. an LLM_PROVIDER_BASE_URL
 * override pointing straight at https://api.groq.com/openai/v1) so the
 * version segment is never duplicated.
 */
function chatCompletionsEndpoint(baseUrl) {
  const clean = String(baseUrl).replace(/\/+$/, '');
  if (/\/v1\/?$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

/** Verbose diagnostics: prints the exact outgoing URL + model to stderr so
 * misrouted providers are diagnosable from the CLI (`--verbose`). */
function logOutgoingRequest(provider, url, model) {
  console.error(`[decode] LLM request → ${url} (provider: ${provider}, model: ${model})`);
}

/**
 * Normalizes a tool call from a provider response into the internal shape
 * consumed by the Agent layer.
 *
 * @param {string} name
 * @param {object} args
 * @returns {{ type: "tool_call", name: string, arguments: object }}
 */
function normalizeToolCall(name, args) {
  return { type: 'tool_call', name: String(name || ''), arguments: args && typeof args === 'object' ? args : {} };
}

/**
 * Requests a text completion (a "summary") from the configured provider.
 *
 * When `options.tools` is provided, the array is forwarded to the provider so
 * the model may emit a structured tool call. If the response contains a tool
 * call, the function returns a normalized internal object:
 *
 *   { type: "tool_call", name: "...", arguments: { ... } }
 *
 * Otherwise it returns the plain text response as before. Existing callers
 * that omit `tools` see no behavior change.
 *
 * When `options.messages` is provided, it is used as the full chat history
 * instead of wrapping `prompt` in a single user message.
 *
 * @param {string} prompt
 * @param {{ cwd?: string, fetchImpl?: typeof fetch, maxTokens?: number, verbose?: boolean, tools?: Array<object>, messages?: Array<{role:string,content:string}> }} options
 * @returns {Promise<string | { type: "tool_call", name: string, arguments: object }>} the model's text output or a normalized tool call
 */
export async function generateSummary(prompt, options = {}) {
  const { cwd, fetchImpl = fetch, maxTokens = MAX_TOKENS, verbose, tools, messages } = options;
  const { provider, apiKey } = getLlmConnection({ cwd });

  if (!provider || !apiKey) {
    throw new Error(
      'No LLM provider configured. Run `decode init` to connect your LLM provider.',
    );
  }

  const base = process.env.LLM_PROVIDER_BASE_URL || PROVIDER_BASE_URLS[provider];
  const model = DEFAULT_MODELS[provider] || DEFAULT_MODELS.other;
  const url =
    provider === 'anthropic' ? `${base}/v1/messages` : chatCompletionsEndpoint(base);

  if (verbose || process.env.DECODE_DEBUG) {
    logOutgoingRequest(provider, url, model);
  }

  if (provider === 'anthropic') {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: messages || [{ role: 'user', content: prompt }],
        ...(tools ? { tools } : {}),
      }),
    });
    if (!res.ok) throw new Error(`LLM request failed with status ${res.status}`);
    const data = await res.json();

    if (tools && Array.isArray(data.content)) {
      const toolUse = data.content.find((block) => block.type === 'tool_use');
      if (toolUse) {
        return normalizeToolCall(toolUse.name, toolUse.input);
      }
    }
    return data.content?.[0]?.text ?? '';
  }

  // openai / groq / other — OpenAI-compatible chat completions
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: messages || [{ role: 'user', content: prompt }],
      ...(tools ? { tools } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed with status ${res.status}`);
  const data = await res.json();
  const message = data.choices?.[0]?.message;

  if (tools && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    const calls = message.tool_calls.map((tc) => {
      const args =
        typeof tc.function?.arguments === 'string'
          ? safeParseJson(tc.function.arguments)
          : (tc.function?.arguments || {});
      return normalizeToolCall(tc.function?.name, args);
    });
    if (calls.length === 1) {
      return calls[0];
    }
    return { type: 'tool_calls', calls };
  }

  return message?.content ?? '';
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
