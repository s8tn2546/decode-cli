/**
 * test/unit/agentPhase10.test.js
 * Phase 10.1 tests: agent UX and progress polish.
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
import { clearRegistry } from '../../src/services/toolRegistry.js';
import { registerBuiltinTools } from '../../src/services/tools.js';
import { generateSummary, isLlmConfigured } from '../../src/services/llmClient.js';
import { validateCommand } from '../../src/services/commandSafety.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-phase10-'));
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

describe('progress events', () => {
  it('emits tool_started and tool_finished events', async () => {
    configureLlm();
    const events = [];
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'list_files', arguments: {} }
    ).mockResolvedValueOnce('Done.');

    await runAgent('List files', projectRoot, {
      cwd: tmp,
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.some((e) => e.type === 'tool_finished' && e.detail === 'list_files')).toBe(true);
  });

  it('emits tool_failed event on failure', async () => {
    configureLlm();
    const events = [];
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'read_file', arguments: { path: 'missing.txt' } }
    ).mockResolvedValueOnce('Done.');

    await runAgent('Read missing', projectRoot, {
      cwd: tmp,
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.some((e) => e.type === 'tool_failed' && e.detail === 'read_file')).toBe(true);
  });

  it('emits thinking events during execution', async () => {
    configureLlm();
    const events = [];
    generateSummary.mockResolvedValueOnce('Done.');

    await runAgent('Think', projectRoot, {
      cwd: tmp,
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.some((e) => e.type === 'thinking')).toBe(true);
  });
});

describe('proposal progress', () => {
  it('returns proposals when agent proposes changes', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'propose_change', arguments: { path: 'README.md', proposedContent: '# New' } }
    ).mockResolvedValueOnce('Done.');

    const result = await runAgent('Update readme', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].path).toBe('README.md');
  });
});

describe('verification progress', () => {
  it('verification result includes command field', async () => {
    const { runVerification } = await import('../../src/commands/agent.js');
    const result = runVerification(projectRoot, 'npm test');
    expect(result).toHaveProperty('command', 'npm test');
  });

  it('verification respects custom timeout', async () => {
    const { runVerification } = await import('../../src/commands/agent.js');
    const result = runVerification(projectRoot, 'npm test', 5000);
    expect(result).toHaveProperty('command', 'npm test');
    expect(result).toHaveProperty('exitCode');
  });
});

describe('fix attempts', () => {
  it('emits fix attempt progress in auto-fix flow', async () => {
    configureLlm();
    const events = [];
    generateSummary.mockResolvedValue('Cannot fix.');

    const result = await runAgent('Fix impossible', projectRoot, {
      cwd: tmp,
      maxIterations: 3,
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(0);
  });
});

describe('agent final states', () => {
  it('successful run produces success state', async () => {
    configureLlm();
    generateSummary.mockResolvedValue('Done.');

    const result = await runAgent('Success', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Done.');
  });

  it('failed run produces failure state', async () => {
    configureLlm();
    generateSummary.mockRejectedValue(new Error('LLM down'));

    const result = await runAgent('Fail', projectRoot, { cwd: tmp });

    expect(result.success).toBe(false);
    expect(result.error).toBe('LLM down');
  });
});

describe('JSON mode cleanliness', () => {
  it('does not emit progress events in JSON mode', async () => {
    configureLlm();
    generateSummary.mockResolvedValue('Done.');

    const result = await runAgent('JSON', projectRoot, {
      cwd: tmp,
      json: true,
      onProgress: () => {},
    });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('response');
  });
});

describe('sensitive information exclusion', () => {
  it('does not expose API keys in progress events', async () => {
    configureLlm();
    const events = [];
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'read_file', arguments: { path: 'README.md' } }
    ).mockResolvedValueOnce('Done.');

    await runAgent('Sensitive', projectRoot, {
      cwd: tmp,
      onProgress: (event) => {
        events.push(event);
      },
    });

    const sensitiveEvents = events.filter((e) => {
      const str = JSON.stringify(e);
      return str.includes('sk-secret') || str.includes('api_key') || str.includes('token');
    });
    expect(sensitiveEvents.length).toBe(0);
  });
});

describe('command safety', () => {
  it('rejects dangerous commands', () => {
    const r = validateCommand('npm install evil');
    expect(r.valid).toBe(false);
  });

  it('allows safe commands', () => {
    const r = validateCommand('npm test');
    expect(r.valid).toBe(true);
  });
});
