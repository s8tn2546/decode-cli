/**
 * test/unit/commandSafety.test.js
 * Unit tests for command safety validation.
 */

import { describe, it, expect } from 'vitest';
import { validateCommand, parseCommand, isAllowedCommand, containsDangerousPatterns } from '../../src/services/commandSafety.js';

describe('isAllowedCommand', () => {
  it('allows exact prefix matches', () => {
    expect(isAllowedCommand('npm test')).toBe(true);
    expect(isAllowedCommand('npm run build')).toBe(true);
    expect(isAllowedCommand('git status')).toBe(true);
  });

  it('allows commands with extra args', () => {
    expect(isAllowedCommand('npm test -- --grep Tag')).toBe(true);
    expect(isAllowedCommand('git log --oneline -5')).toBe(true);
  });

  it('rejects unknown commands', () => {
    expect(isAllowedCommand('evil_command')).toBe(false);
    expect(isAllowedCommand('npm run evil')).toBe(false);
  });
});

describe('containsDangerousPatterns', () => {
  it('rejects shell metacharacters', () => {
    expect(containsDangerousPatterns('npm test && echo pwned')).toBe(true);
    expect(containsDangerousPatterns('npm test; rm -rf /')).toBe(true);
    expect(containsDangerousPatterns('npm test | cat')).toBe(true);
    expect(containsDangerousPatterns('echo $(whoami)')).toBe(true);
    expect(containsDangerousPatterns('echo `whoami`')).toBe(true);
  });

  it('rejects destructive commands', () => {
    expect(containsDangerousPatterns('rm -rf /')).toBe(true);
    expect(containsDangerousPatterns('sudo apt-get install')).toBe(true);
    expect(containsDangerousPatterns('npm install')).toBe(true);
    expect(containsDangerousPatterns('git push')).toBe(true);
    expect(containsDangerousPatterns('git reset --hard')).toBe(true);
  });

  it('allows safe commands', () => {
    expect(containsDangerousPatterns('npm test')).toBe(false);
    expect(containsDangerousPatterns('git status')).toBe(false);
    expect(containsDangerousPatterns('node --version')).toBe(false);
  });
});

describe('validateCommand', () => {
  it('accepts safe allowed commands', () => {
    const r = validateCommand('npm test');
    expect(r.valid).toBe(true);
  });

  it('rejects empty command', () => {
    const r = validateCommand('');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('empty');
  });

  it('rejects unknown commands', () => {
    const r = validateCommand('evil');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('not allowed');
  });

  it('rejects dangerous patterns', () => {
    const r = validateCommand('npm test | cat');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('dangerous patterns');
  });

  it('rejects npm install', () => {
    const r = validateCommand('npm install');
    expect(r.valid).toBe(false);
  });

  it('rejects git push', () => {
    const r = validateCommand('git push');
    expect(r.valid).toBe(false);
  });
});

describe('parseCommand', () => {
  it('parses simple command', () => {
    expect(parseCommand('npm test')).toEqual({ cmd: 'npm', args: ['test'] });
  });

  it('parses command with flags', () => {
    expect(parseCommand('npm run build -- --grep Tag')).toEqual({
      cmd: 'npm',
      args: ['run', 'build', '--', '--grep', 'Tag'],
    });
  });

  it('parses quoted args', () => {
    expect(parseCommand('echo "hello world"')).toEqual({
      cmd: 'echo',
      args: ['hello world'],
    });
  });
});
