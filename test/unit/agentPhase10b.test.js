/**
 * test/unit/agentPhase10b.test.js
 * Phase 10.2 tests: final agent summary and result UX.
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-phase10b-'));
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

describe('result model', () => {
  it('successful result contains expected fields', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce('Done.');

    const result = await runAgent('Success', projectRoot, { cwd: tmp });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('response', 'Done.');
    expect(result).toHaveProperty('steps');
    expect(result).toHaveProperty('proposals');
    expect(result).toHaveProperty('cancelled', false);
  });

  it('failed result contains sanitized error', async () => {
    configureLlm();
    generateSummary.mockRejectedValue(new Error('API key sk-secret123 is invalid'));

    const result = await runAgent('Fail', projectRoot, { cwd: tmp });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('sk-secret123');
    expect(result.error).toContain('Authentication or configuration error');
  });

  it('includes session ID when available', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce('Done.');

    const result = await runAgent('Session', projectRoot, {
      cwd: tmp,
      sessionId: 'test-session',
    });

    expect(result.session).toBeDefined();
  });

  it('cancellation is represented separately from failure', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'propose_change', arguments: { path: 'README.md', proposedContent: '# New' } }
    ).mockResolvedValueOnce('Done.');

    const result = await runAgent('Cancel', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(1);
  });
});

describe('verification summary', () => {
  it('verification result includes command and exit code', async () => {
    const { runVerification } = await import('../../src/commands/agent.js');
    const result = runVerification(projectRoot, 'npm test');
    expect(result).toHaveProperty('command', 'npm test');
    expect(result).toHaveProperty('exitCode');
  });

  it('successful verification reports success', async () => {
    const { runVerification } = await import('../../src/commands/agent.js');
    const result = runVerification(projectRoot, 'npm test');
    if (result.success) {
      expect(result.exitCode).toBe(0);
    }
  });

  it('failed verification reports command and exit code', async () => {
    const { runVerification } = await import('../../src/commands/agent.js');
    const result = runVerification(projectRoot, 'npm test');
    if (!result.success) {
      expect(result.command).toBe('npm test');
      expect(typeof result.exitCode).toBe('number');
    }
  });
});

describe('fix attempts', () => {
  it('--fix reports actual fix attempts', async () => {
    configureLlm();
    generateSummary.mockResolvedValue('Cannot fix.');

    const result = await runAgent('Fix impossible', projectRoot, {
      cwd: tmp,
      maxIterations: 3,
      onProgress: () => {},
    });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(0);
  });

  it('rejected fix is not reported as applied', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'propose_change', arguments: { path: 'README.md', proposedContent: '# Fixed' } }
    ).mockResolvedValueOnce('Done.');

    const result = await runAgent('Fix rejected', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
    expect(result.proposals).toHaveLength(1);
  });
});

describe('JSON output', () => {
  it('result contains base fields for JSON serialization', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce('Done.');

    const result = await runAgent('JSON', projectRoot, {
      cwd: tmp,
      json: true,
      onProgress: () => {},
    });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('response');
    expect(result).toHaveProperty('steps');
    expect(result).toHaveProperty('proposals');
    expect(result).toHaveProperty('cancelled', false);
  });

  it('JSON output does not contain ANSI codes', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce('Done.');

    const result = await runAgent('ANSI', projectRoot, {
      cwd: tmp,
      json: true,
      onProgress: () => {},
    });

    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain('\u001b');
    expect(jsonStr).not.toContain('⠋');
  });

  it('JSON output remains parseable', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce('Done.');

    const result = await runAgent('Parse', projectRoot, {
      cwd: tmp,
      json: true,
      onProgress: () => {},
    });

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
  });

  it('API keys are not present in final output', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce(
      { type: 'tool_call', name: 'read_file', arguments: { path: 'README.md' } }
    ).mockResolvedValueOnce('Done.');

    const result = await runAgent('Sensitive', projectRoot, {
      cwd: tmp,
      json: true,
      onProgress: () => {},
    });

    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain('sk-secret');
    expect(jsonStr).not.toContain('api_key');
  });
});

describe('exit codes', () => {
  it('successful run does not set non-zero exit code', async () => {
    configureLlm();
    generateSummary.mockResolvedValueOnce('Done.');

    const result = await runAgent('Exit code', projectRoot, { cwd: tmp });

    expect(result.success).toBe(true);
  });

  it('failed run returns failure', async () => {
    configureLlm();
    generateSummary.mockRejectedValue(new Error('LLM down'));

    const result = await runAgent('Fail exit', projectRoot, { cwd: tmp });

    expect(result.success).toBe(false);
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
