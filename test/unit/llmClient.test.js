/**
 * test/unit/llmClient.test.js
 * Unit tests for the minimal LLM client — a stub fetchImpl captures requests
 * and returns canned responses, so no real provider is ever called.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isLlmConfigured, generateSummary } from '../../src/services/llmClient.js';
import { saveConnection, disconnect } from '../../src/services/configStore.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-llm-'));
});

afterEach(() => {
  delete process.env.LLM_PROVIDER_BASE_URL;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function stubFetch({ status = 200, json }) {
  const fn = async (url, options = {}) => {
    fn._url = url;
    fn._options = options;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (typeof json === 'function' ? json() : json),
    };
  };
  return fn;
}

describe('llmClient', () => {
  it('isLlmConfigured is false with no provider/key', () => {
    expect(isLlmConfigured({ cwd: tmp })).toBe(false);
  });

  it('isLlmConfigured is true once provider + key are stored', () => {
    saveConnection({ llmProvider: 'anthropic', llmApiKey: 'sk-test' }, { cwd: tmp });
    expect(isLlmConfigured({ cwd: tmp })).toBe(true);
    disconnect({ cwd: tmp });
    expect(isLlmConfigured({ cwd: tmp })).toBe(false);
  });

  it('calls the anthropic API shape and parses the reply', async () => {
    saveConnection({ llmProvider: 'anthropic', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({ json: () => ({ content: [{ text: 'hello from claude' }] }) });

    const result = await generateSummary('summarize', { cwd: tmp, fetchImpl });

    expect(result).toBe('hello from claude');
    expect(fetchImpl._url).toBe('https://api.anthropic.com/v1/messages');
    expect(fetchImpl._options.method).toBe('POST');
    expect(fetchImpl._options.headers['x-api-key']).toBe('sk-test');
    expect(fetchImpl._options.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(fetchImpl._options.body);
    expect(body.messages[0].content).toBe('summarize');
  });

  it('calls the openai-compatible shape for openai', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({ json: () => ({ choices: [{ message: { content: 'hello' } }] }) });

    const result = await generateSummary('summarize', { cwd: tmp, fetchImpl });

    expect(result).toBe('hello');
    expect(fetchImpl._url).toBe('https://api.openai.com/v1/chat/completions');
    expect(fetchImpl._options.headers.authorization).toBe('Bearer sk-test');
  });

  it('passes maxTokens through to the request body', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({ json: () => ({ choices: [{ message: { content: 'x' } }] }) });

    await generateSummary('summarize', { cwd: tmp, fetchImpl, maxTokens: 2048 });
    const body = JSON.parse(fetchImpl._options.body);
    expect(body.max_tokens).toBe(2048);
  });

  it('honors LLM_PROVIDER_BASE_URL override', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    process.env.LLM_PROVIDER_BASE_URL = 'http://127.0.0.1:9999';
    const fetchImpl = stubFetch({ json: () => ({ choices: [{ message: { content: 'x' } }] }) });

    await generateSummary('summarize', { cwd: tmp, fetchImpl });
    expect(fetchImpl._url).toBe('http://127.0.0.1:9999/v1/chat/completions');
  });

  it('constructs the correct Groq endpoint — /openai/v1/chat/completions (404 regression)', async () => {
    saveConnection({ llmProvider: 'groq', llmApiKey: 'gsk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({ json: () => ({ choices: [{ message: { content: 'hi' } }] }) });

    const result = await generateSummary('summarize', { cwd: tmp, fetchImpl });

    expect(result).toBe('hi');
    // The final URL must include the /openai segment — https://api.groq.com/v1/... 404s.
    expect(fetchImpl._url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(fetchImpl._options.headers.authorization).toBe('Bearer gsk-test');
    const body = JSON.parse(fetchImpl._options.body);
    expect(body.model).toBe('llama-3.1-8b-instant');
  });

  it('does not duplicate /v1 when a base URL override already ends in /v1', async () => {
    saveConnection({ llmProvider: 'groq', llmApiKey: 'gsk-test' }, { cwd: tmp });
    process.env.LLM_PROVIDER_BASE_URL = 'https://api.groq.com/openai/v1';
    const fetchImpl = stubFetch({ json: () => ({ choices: [{ message: { content: 'x' } }] }) });

    await generateSummary('summarize', { cwd: tmp, fetchImpl });
    expect(fetchImpl._url).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('logs the exact outgoing URL and model before the request fires when verbose', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({ json: () => ({ choices: [{ message: { content: 'x' } }] }) });
    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    try {
      await generateSummary('summarize', { cwd: tmp, fetchImpl, verbose: true });
    } finally {
      console.error = originalError;
    }
    const joined = logs.join('\n');
    expect(joined).toContain('LLM request → https://api.openai.com/v1/chat/completions');
    expect(joined).toContain('model: gpt-4o-mini');
  });

  it('rejects with a clear message when not configured', async () => {
    await expect(generateSummary('summarize', { cwd: tmp, fetchImpl: stubFetch({}) })).rejects.toThrow(
      /No LLM provider configured/,
    );
  });

  it('rejects when the provider responds with an error status', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    await expect(
      generateSummary('summarize', { cwd: tmp, fetchImpl: stubFetch({ status: 401, json: {} }) }),
    ).rejects.toThrow(/status 401/);
  });

  it('forwards tools in the OpenAI-compatible request body and parses a tool call response', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({
      json: () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"/src/index.js"}' },
                },
              ],
            },
          },
        ],
      }),
    });

    const tools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ];
    const result = await generateSummary('summarize', { cwd: tmp, fetchImpl, tools });

    expect(result).toEqual({ type: 'tool_call', name: 'read_file', arguments: { path: '/src/index.js' } });
    const body = JSON.parse(fetchImpl._options.body);
    expect(body.tools).toEqual(tools);
  });

  it('returns text when OpenAI tools are provided but the model does not call any', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({
      json: () => ({ choices: [{ message: { content: 'plain answer' } }] }),
    });

    const result = await generateSummary('summarize', {
      cwd: tmp,
      fetchImpl,
      tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }],
    });

    expect(result).toBe('plain answer');
  });

  it('falls back to empty object for malformed OpenAI tool-call arguments', async () => {
    saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({
      json: () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: 'not-json' } },
              ],
            },
          },
        ],
      }),
    });

    const result = await generateSummary('summarize', {
      cwd: tmp,
      fetchImpl,
      tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }],
    });

    expect(result).toEqual({ type: 'tool_call', name: 'read_file', arguments: {} });
  });

  it('forwards tools in the Anthropic request body and parses a tool_use response', async () => {
    saveConnection({ llmProvider: 'anthropic', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({
      json: () => ({
        content: [
          { type: 'text', text: 'Let me read that.' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: '/src/index.js' } },
        ],
      }),
    });

    const tools = [
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
    const result = await generateSummary('summarize', { cwd: tmp, fetchImpl, tools });

    expect(result).toEqual({ type: 'tool_call', name: 'read_file', arguments: { path: '/src/index.js' } });
    const body = JSON.parse(fetchImpl._options.body);
    expect(body.tools).toEqual(tools);
  });

  it('returns text when Anthropic tools are provided but the model does not call any', async () => {
    saveConnection({ llmProvider: 'anthropic', llmApiKey: 'sk-test' }, { cwd: tmp });
    const fetchImpl = stubFetch({
      json: () => ({ content: [{ type: 'text', text: 'no tools needed' }] }),
    });

    const result = await generateSummary('summarize', {
      cwd: tmp,
      fetchImpl,
      tools: [{ name: 'read_file', description: 'Read', input_schema: {} }],
    });

    expect(result).toBe('no tools needed');
  });
});
