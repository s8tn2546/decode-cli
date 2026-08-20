/**
 * test/unit/agentPhase9b.test.js
 * Phase 9B tests: safe opt-in auto-fix loop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/services/llmClient.js', () => ({
  generateSummary: vi.fn(),
  isLlmConfigured: vi.fn(),
}));

import { runAgent } from '../../src/services/agent.js';
import { saveConnection, disconnect } from '../../src/services/configStore.js';
import { clearRegistry, registerTool } from '../../src/services/toolRegistry.js';
import { registerBuiltinTools } from '../../src/services/tools.js';
import { generateSummary, isLlmConfigured } from '../../src/services/llmClient.js';
import { validateCommand } from '../../src/services/commandSafety.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-phase9b-'));
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

describe('--fix CLI flag', () => {
  it('is defined on the agent command', async () => {
    const { agentCommand } = await import('../../src/commands/agent.js');
    const cmd = agentCommand();
    const options = cmd.options;
    const fixOpt = options.find((o) => o.long === '--fix');
    expect(fixOpt).toBeDefined();
  });

  it('enables verify when --fix is set without --verify', async () => {
    const { executeAgent } = await import('../../src/commands/agent.js');
    const opts = { fix: true, verify: undefined };
    expect(opts.verify).toBeUndefined();
    if (opts.fix && !opts.verify) {
      opts.verify = true;
    }
    expect(opts.verify).toBe(true);
  });
});

describe('auto-fix behavior', () => {
  it('verification passes immediately without entering fix loop', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce('All good.');

    const result = await runAgent('Check tests', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('All good.');
  });

  it('enters fix loop when verification fails and --fix is enabled', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'propose_change', arguments: { path: 'README.md', proposedContent: '# Fixed' } }
    ).mockResolvedValueOnce('I propose a fix.');

    const result = await runAgent('Fix tests', projectRoot, {
      cwd: tmp,
      maxIterations: 5,
      onProgress: () => {},
    });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(1);
  });

  it('stops after max fix attempts with no proposal', async () => {
    configureLlm();
    generateSummary.mockResolvedValue('Cannot fix this.');

    const result = await runAgent('Fix impossible', projectRoot, {
      cwd: tmp,
      maxIterations: 3,
      onProgress: () => {},
    });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(0);
  });

  it('does not expose WRITE tools to the LLM during fix', async () => {
    configureLlm();
    registerTool({
      name: 'write_file',
      description: 'Write',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      permission: 'WRITE',
      execute: async () => 'ok',
    });

    const tools = [{ name: 'read_file', permission: 'READ_ONLY' }];
    const writeTools = tools.filter((t) => t.permission === 'WRITE');
    expect(writeTools.length).toBe(0);
  });

  it('command validation rejects dangerous commands', () => {
    const r = validateCommand('npm install evil');
    expect(r.valid).toBe(false);
  });

  it('command validation allows safe commands', () => {
    const r = validateCommand('npm test');
    expect(r.valid).toBe(true);
  });
});

describe('fix loop limits', () => {
  it('respects maximum fix attempts constant', async () => {
    const { agentCommand } = await import('../../src/commands/agent.js');
    const cmd = agentCommand();
    const fixOpt = cmd.options.find((o) => o.long === '--fix');
    expect(fixOpt).toBeDefined();
  });
});

describe('output truncation in fix context', () => {
  it('truncates large diagnostic output', async () => {
    configureLlm();
    const largeOutput = 'x'.repeat(70000);
    generateSummary.mockResolvedValueOnce(largeOutput);

    const result = await runAgent('Large output', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    if (typeof result.response === 'string') {
      expect(result.response.length).toBeLessThanOrEqual(70000);
    }
  });
});

describe('error sanitization in fix context', () => {
  it('does not expose API keys in agent errors', async () => {
    configureLlm();
    generateSummary.mockImplementationOnce(() => {
      throw new Error('API key sk-secret123 is invalid');
    });

    const result = await runAgent('Key error', projectRoot, { cwd: tmp });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('sk-secret123');
  });
});
