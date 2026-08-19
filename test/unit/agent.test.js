/**
 * test/unit/agent.test.js
 * Unit tests for the DeCode Agent orchestrator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/services/llmClient.js', () => ({
  generateSummary: vi.fn(),
  isLlmConfigured: vi.fn(),
}));

import { runAgent, MAX_ITERATIONS } from '../../src/services/agent.js';
import { saveConnection, disconnect } from '../../src/services/configStore.js';
import { clearRegistry, registerTool, Permission } from '../../src/services/toolRegistry.js';
import { registerBuiltinTools } from '../../src/services/tools.js';
import { generateSummary, isLlmConfigured } from '../../src/services/llmClient.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-agent-'));
  projectRoot = tmp;
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Test Project\n');
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.js'), 'console.log("hi");');
  clearRegistry();
  registerBuiltinTools();
});

afterEach(() => {
  delete process.env.LLM_PROVIDER_BASE_URL;
  disconnect({ cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
});

function configureLlm() {
  saveConnection({ llmProvider: 'openai', llmApiKey: 'sk-test' }, { cwd: tmp });
  isLlmConfigured.mockReturnValue(true);
}

describe('runAgent', () => {
  it('returns final answer without tool call', async () => {
    configureLlm();
    generateSummary.mockResolvedValue('This is the final answer.');

    const result = await runAgent('Explain auth', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('This is the final answer.');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].type).toBe('text');
  });

  it('executes one tool call then returns final answer', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'list_files', arguments: {} }
    ).mockResolvedValueOnce('I found the files.');

    const result = await runAgent('List files', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('I found the files.');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].type).toBe('tool_call');
    expect(result.steps[0].name).toBe('list_files');
    expect(result.steps[0].result.success).toBe(true);
    expect(result.steps[1].type).toBe('text');
  });

  it('executes multiple tool calls before final answer', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'list_files', arguments: {} }
    ).mockResolvedValueOnce(
      { type: 'tool_call', name: 'read_file', arguments: { path: 'README.md' } }
    ).mockResolvedValueOnce('Done.');

    const result = await runAgent('Readme', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Done.');
    expect(result.steps).toHaveLength(3);
    expect(result.steps.filter((s) => s.type === 'tool_call')).toHaveLength(2);
  });

  it('executes multiple simultaneous tool calls sequentially', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce({
      type: 'tool_calls',
      calls: [
        { type: 'tool_call', name: 'list_files', arguments: {} },
        { type: 'tool_call', name: 'read_file', arguments: { path: 'README.md' } },
      ],
    }).mockResolvedValueOnce('Done.');

    const result = await runAgent('Multi', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Done.');
    expect(result.steps).toHaveLength(3);
    expect(result.steps.filter((s) => s.type === 'tool_call')).toHaveLength(2);
    expect(result.steps[0].name).toBe('list_files');
    expect(result.steps[1].name).toBe('read_file');
  });

  it('handles mixed successful and failed tool calls', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce({
      type: 'tool_calls',
      calls: [
        { type: 'tool_call', name: 'read_file', arguments: { path: 'missing.txt' } },
        { type: 'tool_call', name: 'list_files', arguments: {} },
      ],
    }).mockResolvedValueOnce('Done.');

    const result = await runAgent('Mixed', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[1].result.success).toBe(true);
  });

  it('reports progress events during execution', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'list_files', arguments: {} }
    ).mockResolvedValueOnce('Done.');

    const progressEvents = [];
    await runAgent('Progress', projectRoot, {
      cwd: tmp,
      onProgress: (event) => {
        progressEvents.push(event);
      },
    });

    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.some((e) => e.type === 'thinking')).toBe(true);
    expect(progressEvents.some((e) => e.type === 'tool')).toBe(true);
  });

  it('returns tool execution error to LLM and continues', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'read_file', arguments: { path: 'missing.txt' } }
    ).mockResolvedValueOnce('The file is missing.');

    const result = await runAgent('Read missing', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('The file is missing.');
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.error.code).toBe('EXECUTION_ERROR');
  });

  it('rejects unknown tool without crashing', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'unknown_tool', arguments: {} }
    ).mockResolvedValueOnce('I cannot do that.');

    const result = await runAgent('Bad tool', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('I cannot do that.');
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.error.code).toBe('UNKNOWN_TOOL');
  });

  it('rejects invalid tool arguments without crashing', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'read_file', arguments: {} }
    ).mockResolvedValueOnce('I need a path.');

    const result = await runAgent('Read', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('I need a path.');
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.error.code).toBe('VALIDATION_ERROR');
  });

  it('stops at maximum iterations', async () => {
    configureLlm();
    const toolCall = { type: 'tool_call', name: 'list_files', arguments: {} };
    const responses = Array(MAX_ITERATIONS).fill(toolCall);
    generateSummary.mockResolvedValue(...responses);

    const result = await runAgent('Loop', projectRoot, {
      cwd: tmp,
      maxIterations: MAX_ITERATIONS,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Agent stopped after ${MAX_ITERATIONS} iterations`);
    expect(result.steps).toHaveLength(MAX_ITERATIONS);
  });

  it('fails cleanly when LLM throws', async () => {
    configureLlm();
    generateSummary.mockRejectedValue(new Error('LLM down'));

    const result = await runAgent('Goal', projectRoot, { cwd: tmp });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LLM down');
    expect(result.steps).toHaveLength(0);
  });

  it('fails when no goal is provided', async () => {
    configureLlm();
    const result = await runAgent('', projectRoot, { cwd: tmp });
    expect(result.success).toBe(false);
    expect(result.error).toBe('A goal is required');
  });

  it('fails when no LLM is configured', async () => {
    isLlmConfigured.mockReturnValue(false);
    const result = await runAgent('Goal', projectRoot, { cwd: tmp });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No LLM provider configured');
  });

  it('only exposes READ_ONLY tools', async () => {
    configureLlm();
    registerTool({
      name: 'write_file',
      description: 'Write',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      permission: Permission.WRITE,
      execute: async () => 'ok',
    });

    const { ToolExecutor } = await import('../../src/services/toolExecutor.js');
    const executor = new ToolExecutor(projectRoot);
    const r = await executor.execute('write_file', { path: 'x.txt' });
    expect(r.success).toBe(false);
    expect(r.error.code).toBe('PERMISSION_DENIED');
  });

  it('returns proposals when LLM calls propose_change', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'propose_change', arguments: { path: 'README.md', proposedContent: '# New' } }
    ).mockResolvedValueOnce('Done.');

    const result = await runAgent('Update readme', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].path).toBe('README.md');
    expect(result.proposals[0].proposedContent).toBe('# New');
  });

  it('returns multiple proposals', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'propose_change', arguments: { path: 'a.js', proposedContent: 'A' } }
    ).mockResolvedValueOnce(
      { type: 'tool_call', name: 'propose_change', arguments: { path: 'b.js', proposedContent: 'B' } }
    ).mockResolvedValueOnce('Done.');

    const result = await runAgent('Multi', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0].path).toBe('a.js');
    expect(result.proposals[1].path).toBe('b.js');
  });
});

describe('MAX_ITERATIONS', () => {
  it('is a sensible default', () => {
    expect(MAX_ITERATIONS).toBe(10);
  });
});
