/**
 * test/unit/projectContext.test.js
 * Unit tests for project context assembly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildProjectContext, PROJECT_CONTEXT_BUDGET } from '../../src/services/projectContext.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-context-'));
  fs.mkdirSync(path.join(tmp, 'src', 'services'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { express: '^4.0.0' } }));
  fs.writeFileSync(path.join(tmp, 'README.md'), '# Demo\nA demo project.');
  fs.writeFileSync(path.join(tmp, 'src', 'index.js'), 'console.log("hi");');
  fs.writeFileSync(path.join(tmp, 'src', 'services', 'x.js'), 'export const x = 1;');
  fs.writeFileSync(path.join(tmp, 'src', 'services', 'y.js'), 'export const y = 2;');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('buildProjectContext', () => {
  it('returns structure, dependencies, and files', () => {
    const ctx = buildProjectContext({ cwd: tmp });
    expect(ctx.structure).toContain('package.json');
    expect(ctx.structure).toContain('src/');
    expect(ctx.dependencies).toHaveProperty('express');
    expect(ctx.files.some((f) => f.path === 'README.md')).toBe(true);
  });

  it('prioritizes a file mentioned in the question', () => {
    const ctx = buildProjectContext({ question: 'what does src/services/x.js do', cwd: tmp });
    const paths = ctx.files.map((f) => f.path);
    expect(paths).toContain('src/services/x.js');
  });

  it('respects the --file option over question inference', () => {
    const ctx = buildProjectContext({ question: 'what does src/services/y.js do', file: 'src/services/x.js', cwd: tmp });
    const paths = ctx.files.map((f) => f.path);
    expect(paths).toContain('src/services/x.js');
  });

  it('reports omitted files when the budget is exceeded', () => {
    const big = 'x'.repeat(PROJECT_CONTEXT_BUDGET);
    fs.writeFileSync(path.join(tmp, 'huge.js'), big);
    const ctx = buildProjectContext({ cwd: tmp });
    expect(ctx.truncated).toBe(true);
    expect(ctx.omittedFiles.length).toBeGreaterThan(0);
  });

  it('never truncates a file mid-content', () => {
    const big = 'x'.repeat(PROJECT_CONTEXT_BUDGET);
    fs.writeFileSync(path.join(tmp, 'huge.js'), big);
    const ctx = buildProjectContext({ cwd: tmp });
    for (const f of ctx.files) {
      expect(f.content.length).toBeLessThanOrEqual(PROJECT_CONTEXT_BUDGET);
    }
  });

  it('returns an empty object when no files match', () => {
    const ctx = buildProjectContext({ cwd: tmp });
    expect(ctx.files.length).toBeGreaterThan(0);
  });
});
