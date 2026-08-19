/**
 * test/unit/proposedChange.test.js
 * Unit tests for proposed change modeling, diff generation, conflict detection,
 * and controlled file application.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ProposedChange,
  generateUnifiedDiff,
  detectConflicts,
  applyProposals,
} from '../../src/services/proposedChange.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-proposed-'));
  projectRoot = tmp;
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('ProposedChange', () => {
  it('tracks new files with null originalContent', () => {
    const change = new ProposedChange({ path: 'src/new.js', proposedContent: 'hello' });
    expect(change.path).toBe('src/new.js');
    expect(change.originalContent).toBeNull();
    expect(change.proposedContent).toBe('hello');
    expect(change.isNewFile).toBe(true);
    expect(change.hasChanges).toBe(true);
  });

  it('tracks modified files', () => {
    const change = new ProposedChange({ path: 'src/old.js', originalContent: 'a', proposedContent: 'b' });
    expect(change.isNewFile).toBe(false);
    expect(change.hasChanges).toBe(true);
  });

  it('detects no-op changes', () => {
    const change = new ProposedChange({ path: 'src/same.js', originalContent: 'a', proposedContent: 'a' });
    expect(change.hasChanges).toBe(false);
  });
});

describe('generateUnifiedDiff', () => {
  it('generates diff for a modified file', () => {
    const diff = generateUnifiedDiff('line1\nline2\nline3', 'line1\nline2 changed\nline3', 'src/test.js');
    expect(diff).toContain('--- a/src/test.js');
    expect(diff).toContain('+++ b/src/test.js');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+line2 changed');
  });

  it('generates diff for a new file', () => {
    const diff = generateUnifiedDiff(null, 'line1\nline2', 'src/new.js');
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ b/src/new.js');
    expect(diff).toContain('+line1');
    expect(diff).toContain('+line2');
  });

  it('returns null for identical content', () => {
    const diff = generateUnifiedDiff('line1\nline2', 'line1\nline2', 'src/test.js');
    expect(diff).toBeNull();
  });

  it('returns null for two empty strings', () => {
    const diff = generateUnifiedDiff('', '', 'src/test.js');
    expect(diff).toBeNull();
  });

  it('handles empty original with non-empty proposed', () => {
    const diff = generateUnifiedDiff('', 'hello', 'src/test.js');
    expect(diff).toContain('+hello');
  });
});

describe('detectConflicts', () => {
  it('detects no conflict when file is unchanged', () => {
    fs.writeFileSync(path.join(projectRoot, 'src', 'test.js'), 'hello');
    const proposals = [new ProposedChange({ path: 'src/test.js', originalContent: 'hello', proposedContent: 'world' })];
    const conflicts = detectConflicts(proposals, projectRoot);
    expect(conflicts).toHaveLength(0);
  });

  it('detects conflict when file changed after proposal', () => {
    fs.writeFileSync(path.join(projectRoot, 'src', 'test.js'), 'hello');
    const proposals = [new ProposedChange({ path: 'src/test.js', originalContent: 'old', proposedContent: 'new' })];
    const conflicts = detectConflicts(proposals, projectRoot);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe('src/test.js');
    expect(conflicts[0].message).toContain('changed');
  });

  it('detects conflict when file was deleted', () => {
    const proposals = [new ProposedChange({ path: 'src/missing.js', originalContent: 'old', proposedContent: 'new' })];
    const conflicts = detectConflicts(proposals, projectRoot);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toContain('deleted');
  });

  it('allows new files even if they now exist', () => {
    fs.writeFileSync(path.join(projectRoot, 'src', 'new.js'), 'hello');
    const proposals = [new ProposedChange({ path: 'src/new.js', originalContent: null, proposedContent: 'world' })];
    const conflicts = detectConflicts(proposals, projectRoot);
    expect(conflicts).toHaveLength(0);
  });
});

describe('applyProposals', () => {
  it('writes a new file', () => {
    const proposals = [new ProposedChange({ path: 'src/new.js', originalContent: null, proposedContent: 'hello' })];
    const results = applyProposals(proposals, projectRoot);
    expect(results[0].success).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'src', 'new.js'), 'utf8')).toBe('hello');
  });

  it('overwrites an existing file', () => {
    fs.writeFileSync(path.join(projectRoot, 'src', 'old.js'), 'old');
    const proposals = [new ProposedChange({ path: 'src/old.js', originalContent: 'old', proposedContent: 'new' })];
    const results = applyProposals(proposals, projectRoot);
    expect(results[0].success).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'src', 'old.js'), 'utf8')).toBe('new');
  });

  it('handles multiple proposals', () => {
    fs.writeFileSync(path.join(projectRoot, 'a.js'), 'oldA');
    fs.writeFileSync(path.join(projectRoot, 'b.js'), 'oldB');
    const proposals = [
      new ProposedChange({ path: 'a.js', originalContent: 'oldA', proposedContent: 'newA' }),
      new ProposedChange({ path: 'b.js', originalContent: 'oldB', proposedContent: 'newB' }),
    ];
    const results = applyProposals(proposals, projectRoot);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'a.js'), 'utf8')).toBe('newA');
    expect(fs.readFileSync(path.join(projectRoot, 'b.js'), 'utf8')).toBe('newB');
  });

  it('rejects path traversal', () => {
    const proposals = [new ProposedChange({ path: '../../etc/passwd', originalContent: null, proposedContent: 'evil' })];
    const results = applyProposals(proposals, projectRoot);
    expect(results[0].success).toBe(false);
  });

  it('rejects absolute path outside project root', () => {
    const proposals = [new ProposedChange({ path: '/etc/passwd', originalContent: null, proposedContent: 'evil' })];
    const results = applyProposals(proposals, projectRoot);
    expect(results[0].success).toBe(false);
  });

  it('creates parent directories for new nested files', () => {
    const proposals = [new ProposedChange({ path: 'src/deep/nested/file.js', originalContent: null, proposedContent: 'hello' })];
    const results = applyProposals(proposals, projectRoot);
    expect(results[0].success).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'src', 'deep', 'nested', 'file.js'))).toBe(true);
  });
});
