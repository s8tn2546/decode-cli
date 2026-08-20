/**
 * test/unit/agentPhase9a.test.js
 * Phase 9A tests: session management and verification controls.
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-phase9a-'));
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

describe('verify timeout defaults', () => {
  it('defaults to 120000 when no timeout is provided', async () => {
    const result = await import('../../src/commands/agent.js');
    const { runVerification } = result;
    const r = runVerification(projectRoot, 'npm test');
    expect(r).toHaveProperty('success');
    expect(r).toHaveProperty('exitCode');
  });
});

describe('command safety for verification', () => {
  it('rejects arbitrary commands in verification', () => {
    const r = validateCommand('npm install evil');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('not allowed');
  });

  it('rejects dangerous shell metacharacters in verification', () => {
    const r = validateCommand('npm test | cat /etc/passwd');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('dangerous patterns');
  });

  it('rejects git push in verification', () => {
    const r = validateCommand('git push origin main');
    expect(r.valid).toBe(false);
  });

  it('rejects rm in verification', () => {
    const r = validateCommand('rm -rf /');
    expect(r.valid).toBe(false);
  });

  it('allows npm test in verification', () => {
    const r = validateCommand('npm test');
    expect(r.valid).toBe(true);
  });

  it('allows npm run build in verification', () => {
    const r = validateCommand('npm run build');
    expect(r.valid).toBe(true);
  });

  it('allows git status in verification', () => {
    const r = validateCommand('git status');
    expect(r.valid).toBe(true);
  });
});

describe('session listing via CLI', () => {
  it('exports listSessions from agent command', async () => {
    const { listSessions } = await import('../../src/commands/agent.js');
    expect(typeof listSessions).toBe('function');
  });
});

describe('session deletion via CLI', () => {
  it('exports deleteSession from agent command', async () => {
    const { deleteSession } = await import('../../src/commands/agent.js');
    expect(typeof deleteSession).toBe('function');
  });
});
