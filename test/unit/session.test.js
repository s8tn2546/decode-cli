/**
 * test/unit/session.test.js
 * Unit tests for the interactive session module.
 * Parser tests run here; dispatch/REPL tests are in test/integration/session.test.js.
 */
import { describe, it, expect } from 'vitest';

// --- Task 1: verify named exports exist on every command module ---

import { executeApiList, executeApiCheck } from '../../src/commands/api.js';
import {
  executeGithubConnect,
  executeGithubProfile,
  executeGithubAnalyze,
} from '../../src/commands/github.js';
import { executeDoc, executeDocCheck } from '../../src/commands/doc.js';
import { executeAudit } from '../../src/commands/audit.js';
import { executeAsk } from '../../src/commands/ask.js';
import { executeInit } from '../../src/commands/init.js';
import { executeConnect } from '../../src/commands/connect.js';
import { executeDisconnect } from '../../src/commands/disconnect.js';
import { executeStatus } from '../../src/commands/status.js';
import {
  executeConfigList,
  executeConfigSet,
  executeConfigReset,
} from '../../src/commands/config.js';

describe('command module exports', () => {
  it('api exports executeApiList', () => { expect(typeof executeApiList).toBe('function'); });
  it('api exports executeApiCheck', () => { expect(typeof executeApiCheck).toBe('function'); });
  it('github exports executeGithubConnect', () => { expect(typeof executeGithubConnect).toBe('function'); });
  it('github exports executeGithubProfile', () => { expect(typeof executeGithubProfile).toBe('function'); });
  it('github exports executeGithubAnalyze', () => { expect(typeof executeGithubAnalyze).toBe('function'); });
  it('doc exports executeDoc', () => { expect(typeof executeDoc).toBe('function'); });
  it('doc exports executeDocCheck', () => { expect(typeof executeDocCheck).toBe('function'); });
  it('audit exports executeAudit', () => { expect(typeof executeAudit).toBe('function'); });
  it('ask exports executeAsk', () => { expect(typeof executeAsk).toBe('function'); });
  it('init exports executeInit', () => { expect(typeof executeInit).toBe('function'); });
  it('connect exports executeConnect', () => { expect(typeof executeConnect).toBe('function'); });
  it('disconnect exports executeDisconnect', () => { expect(typeof executeDisconnect).toBe('function'); });
  it('status exports executeStatus', () => { expect(typeof executeStatus).toBe('function'); });
  it('config exports executeConfigList', () => { expect(typeof executeConfigList).toBe('function'); });
  it('config exports executeConfigSet', () => { expect(typeof executeConfigSet).toBe('function'); });
  it('config exports executeConfigReset', () => { expect(typeof executeConfigReset).toBe('function'); });
});

// --- Task 2: parseSlashInput parser ---
import { parseSlashInput } from '../../src/session/session.js';

describe('parseSlashInput', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashInput('hello world')).toBeNull();
  });

  it('parses a bare slash command with no subcommand', () => {
    expect(parseSlashInput('/api')).toEqual({ command: 'api', args: [], opts: {} });
  });

  it('parses a slash command with a subcommand', () => {
    expect(parseSlashInput('/api list')).toEqual({ command: 'api list', args: [], opts: {} });
  });

  it('parses a slash command with a flag', () => {
    expect(parseSlashInput('/api list --json')).toEqual({ command: 'api list', args: [], opts: { json: true } });
  });

  it('parses a slash command with a positional arg and a flag', () => {
    expect(parseSlashInput('/github analyze my-org/my-repo --json')).toEqual({
      command: 'github analyze',
      args: ['my-org/my-repo'],
      opts: { json: true },
    });
  });

  it('parses --key=value flags', () => {
    expect(parseSlashInput('/config set theme dark')).toEqual({
      command: 'config set',
      args: ['theme', 'dark'],
      opts: {},
    });
  });

  it('parses -y short flags as boolean', () => {
    expect(parseSlashInput('/disconnect -y')).toEqual({ command: 'disconnect', args: [], opts: { y: true } });
  });
});
