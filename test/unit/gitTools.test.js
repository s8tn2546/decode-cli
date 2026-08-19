/**
 * test/unit/gitTools.test.js
 * Unit tests for the git inspection tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { clearRegistry, registerTool, Permission } from '../../src/services/toolRegistry.js';
import { ToolExecutor } from '../../src/services/toolExecutor.js';
import { gitStatusTool } from '../../src/services/tools/gitStatus.js';
import { gitDiffTool } from '../../src/services/tools/gitDiff.js';
import { gitLogTool } from '../../src/services/tools/gitLog.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-git-'));
  projectRoot = tmp;
  fs.writeFileSync(path.join(projectRoot, 'file.txt'), 'hello');
  execSync('git init', { cwd: projectRoot, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: projectRoot, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: projectRoot, stdio: 'ignore' });
  execSync('git add file.txt', { cwd: projectRoot, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: projectRoot, stdio: 'ignore' });
  clearRegistry();
  registerTool(gitStatusTool);
  registerTool(gitDiffTool);
  registerTool(gitLogTool);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('git tools', () => {
  it('git_status returns branch and clean status', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('git_status', {});
    expect(result.success).toBe(true);
    expect(['master', 'main']).toContain(result.data.branch);
    expect(result.data.changes).toHaveLength(0);
  });

  it('git_status detects changed files', async () => {
    fs.writeFileSync(path.join(projectRoot, 'file.txt'), 'world');
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('git_status', {});
    expect(result.success).toBe(true);
    expect(result.data.changes.length).toBeGreaterThan(0);
    expect(result.data.changes[0]).toContain('file.txt');
  });

  it('git_diff returns empty diff for clean repo', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('git_diff', {});
    expect(result.success).toBe(true);
    expect(result.data.diff).toBe('');
  });

  it('git_diff returns changes', async () => {
    fs.writeFileSync(path.join(projectRoot, 'file.txt'), 'world');
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('git_diff', {});
    expect(result.success).toBe(true);
    expect(result.data.diff).toContain('-hello');
    expect(result.data.diff).toContain('+world');
  });

  it('git_log returns recent commits', async () => {
    const executor = new ToolExecutor(projectRoot);
    const result = await executor.execute('git_log', {});
    expect(result.success).toBe(true);
    expect(result.data.entries.length).toBeGreaterThan(0);
    expect(result.data.entries[0]).toContain('initial');
  });

  it('git tools remain READ_ONLY', async () => {
    const status = gitStatusTool;
    const diff = gitDiffTool;
    const log = gitLogTool;
    expect(status.permission).toBe(Permission.READ_ONLY);
    expect(diff.permission).toBe(Permission.READ_ONLY);
    expect(log.permission).toBe(Permission.READ_ONLY);
  });
});
