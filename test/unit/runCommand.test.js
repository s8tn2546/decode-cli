/**
 * test/unit/runCommand.test.js
 * Unit tests for the safe shell command tool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { clearRegistry, registerTool, Permission } from '../../src/services/toolRegistry.js';
import { ToolExecutor } from '../../src/services/toolExecutor.js';
import { runCommandTool } from '../../src/services/tools/runCommand.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-shell-'));
  projectRoot = tmp;
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"test"}');
  clearRegistry();
  registerTool(runCommandTool);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('run_command tool', () => {
  it('executes an allowed npm command', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'node --version' });
    expect(result.success).toBe(true);
    expect(result.data.exitCode).toBe(0);
    const output = (result.data.stdout || '') + (result.data.stderr || '');
    expect(output).toContain('v');
  });

  it('executes an allowed git command', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'npm --version' });
    expect(result.success).toBe(true);
    expect(result.data.exitCode).toBe(0);
  });

  it('rejects a dangerous command (rm)', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'rm -rf /' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('not allowed');
  });

  it('rejects a command with shell metacharacters (&&)', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'npm test && echo pwned' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('dangerous patterns');
  });

  it('rejects a command with shell metacharacters (;)', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'npm test; rm -rf /' });
    expect(result.success).toBe(false);
    expect(result.error.message).toMatch(/not allowed|dangerous patterns/);
  });

  it('rejects a command with shell metacharacters (pipe)', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'npm test | cat' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('dangerous patterns');
  });

  it('rejects a command with command substitution', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'echo $(whoami)' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('not allowed');
  });

  it('rejects a command with backticks', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'echo `whoami`' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('not allowed');
  });

  it('rejects an unknown command', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'evil_command' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('not allowed');
  });

  it('rejects npm install', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'npm install' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('not allowed');
  });

  it('rejects git push', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'git push' });
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('not allowed');
  });

  it('rejects missing command argument', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', {});
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('executes with cwd = projectRoot', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'pwd' });
    // pwd is not on allowlist, so it should be rejected
    expect(result.success).toBe(false);
    expect(result.error.message).toContain('not allowed');
  });

  it('handles command failure gracefully', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'npm run build' });
    expect(result.success).toBe(true);
    expect(result.data.exitCode).not.toBe(0);
    expect(result.data.stderr).toContain('Missing script');
  });

  it('limits output size', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('run_command', { command: 'node --version' });
    expect(result.success).toBe(true);
    const output = (result.data.stdout || '') + (result.data.stderr || '');
    expect(output.length).toBeGreaterThan(0);
  });
});
