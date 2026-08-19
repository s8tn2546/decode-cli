/**
 * test/unit/tools.test.js
 * Unit tests for the DeCode Tool Registry, Tool Executor, and built-in tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  registerTool,
  getTool,
  hasTool,
  listTools,
  clearRegistry,
  Permission,
} from '../../src/services/toolRegistry.js';

import {
  ToolExecutor,
  successResult,
  errorResult,
  validateArgs,
  resolveProjectPath,
} from '../../src/services/toolExecutor.js';

import { registerBuiltinTools } from '../../src/services/tools.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-tools-'));
  projectRoot = tmp;
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Test Project\n');
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'index.js'), 'console.log("hi");');
  fs.writeFileSync(path.join(projectRoot, 'src', 'utils.js'), 'export const x = 1;');
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"test"}');
  clearRegistry();
  registerBuiltinTools();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('toolRegistry', () => {
  it('registers and retrieves a tool', () => {
    expect(hasTool('read_file')).toBe(true);
    expect(getTool('read_file').name).toBe('read_file');
  });

  it('returns null for unknown tools', () => {
    expect(getTool('nonexistent')).toBeNull();
  });

  it('listTools returns all registered tools', () => {
    const names = listTools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'list_files', 'search_files', 'propose_change', 'run_command', 'git_status', 'git_diff', 'git_log']));
    expect(names).toHaveLength(8);
  });

  it('clearRegistry removes all tools', () => {
    clearRegistry();
    expect(listTools()).toHaveLength(0);
  });
});

describe('validateArgs', () => {
  it('passes when no schema or args', () => {
    expect(validateArgs({}, {})).toEqual({ valid: true });
  });

  it('rejects missing required fields', () => {
    expect(validateArgs({ required: ['path'] }, {})).toEqual({
      valid: false,
      message: 'Missing required argument: path',
    });
  });

  it('rejects wrong types', () => {
    expect(validateArgs({ properties: { path: { type: 'string' } } }, { path: 123 })).toEqual({
      valid: false,
      message: 'Argument "path" must be a string',
    });
  });

  it('passes with correct types', () => {
    expect(validateArgs({ properties: { path: { type: 'string' } } }, { path: 'foo.js' })).toEqual({
      valid: true,
    });
  });
});

describe('resolveProjectPath', () => {
  it('resolves a relative path inside the root', () => {
    const resolved = resolveProjectPath('src/index.js', projectRoot);
    expect(resolved).toBe(path.resolve(projectRoot, 'src/index.js'));
  });

  it('rejects path traversal with ../', () => {
    expect(() => resolveProjectPath('../../etc/passwd', projectRoot)).toThrow('Path escapes project root');
  });

  it('rejects absolute path outside root', () => {
    expect(() => resolveProjectPath('/etc/passwd', projectRoot)).toThrow('Path escapes project root');
  });

  it('allows absolute path inside root', () => {
    const inside = path.resolve(projectRoot, 'src/index.js');
    const resolved = resolveProjectPath(inside, projectRoot);
    expect(resolved).toBe(inside);
  });
});

describe('ToolExecutor', () => {
  let executor;

  beforeEach(() => {
    executor = new ToolExecutor(projectRoot);
  });

  it('returns UNKNOWN_TOOL for unregistered tools', async () => {
    const result = await executor.execute('nonexistent', {});
    expect(result).toEqual(errorResult('Unknown tool: nonexistent', 'UNKNOWN_TOOL'));
  });

  it('rejects non-READ_ONLY tools', async () => {
    registerTool({
      name: 'write_file',
      description: 'Write',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      permission: Permission.WRITE,
      execute: async () => 'ok',
    });
    const result = await executor.execute('write_file', { path: 'x.txt' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  it('validates missing required arguments', async () => {
    const result = await executor.execute('read_file', {});
    expect(result).toEqual(errorResult('Missing required argument: path', 'VALIDATION_ERROR'));
  });

  it('reads a valid file', async () => {
    const result = await executor.execute('read_file', { path: 'README.md' });
    expect(result.success).toBe(true);
    expect(result.data.path).toBe('README.md');
    expect(result.data.content).toContain('# Test Project');
  });

  it('returns error for missing file', async () => {
    const result = await executor.execute('read_file', { path: 'nonexistent.txt' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('EXECUTION_ERROR');
    expect(result.error.message).toContain('nonexistent.txt');
  });

  it('rejects path traversal in read_file', async () => {
    const result = await executor.execute('read_file', { path: '../../etc/passwd' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('EXECUTION_ERROR');
    expect(result.error.message).toContain('escapes project root');
  });

  it('rejects absolute path outside root', async () => {
    const result = await executor.execute('read_file', { path: '/etc/passwd' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('EXECUTION_ERROR');
  });

  it('list_files returns entries', async () => {
    const result = await executor.execute('list_files', {});
    expect(result.success).toBe(true);
    const paths = result.data.entries.map((e) => e.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('src/index.js');
    expect(paths).not.toContain('node_modules/');
  });

  it('list_files rejects path traversal', async () => {
    const result = await executor.execute('list_files', { path: '../../etc' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('EXECUTION_ERROR');
  });

  it('search_files returns matching files', async () => {
    const result = await executor.execute('search_files', { query: 'index.js' });
    expect(result.success).toBe(true);
    expect(result.data.matches.some((m) => m.path === 'src/index.js')).toBe(true);
  });

  it('search_files rejects missing query', async () => {
    const result = await executor.execute('search_files', {});
    expect(result).toEqual(errorResult('Missing required argument: query', 'VALIDATION_ERROR'));
  });

  it('search_files rejects empty query', async () => {
    const result = await executor.execute('search_files', { query: '   ' });
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('EXECUTION_ERROR');
  });
});
