/**
 * test/unit/session.test.js
 * Unit tests for session persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
} from '../../src/services/session.js';

let tmp;
let projectRoot;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-session-'));
  projectRoot = tmp;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('createSession', () => {
  it('creates a session with required fields', () => {
    const session = createSession({ goal: 'Test goal', projectRoot });
    expect(session.version).toBe(1);
    expect(session.sessionId).toMatch(/^session_/);
    expect(session.goal).toBe('Test goal');
    expect(session.projectRoot).toBe(projectRoot);
    expect(session.history).toEqual([]);
    expect(session.proposals).toEqual([]);
    expect(session.createdAt).toBe(session.updatedAt);
  });

  it('generates unique session IDs', () => {
    const a = createSession({ goal: 'A', projectRoot });
    const b = createSession({ goal: 'B', projectRoot });
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe('saveSession and loadSession', () => {
  it('persists and restores session data', () => {
    const session = createSession({ goal: 'Persist', projectRoot });
    session.history = [{ type: 'text', content: 'hello', iteration: 1 }];
    session.proposals = [{ path: 'a.js', originalContent: null, proposedContent: 'x' }];

    saveSession(session, projectRoot);

    const loaded = loadSession(projectRoot, session.sessionId);
    expect(loaded.sessionId).toBe(session.sessionId);
    expect(loaded.goal).toBe('Persist');
    expect(loaded.history).toHaveLength(1);
    expect(loaded.proposals).toHaveLength(1);
    expect(loaded.proposals[0].path).toBe('a.js');
  });

  it('creates .decode/sessions directory lazily', () => {
    const session = createSession({ goal: 'Lazy', projectRoot });
    saveSession(session, projectRoot);
    const dir = path.join(projectRoot, '.decode', 'sessions');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('uses atomic write (temp file + rename)', () => {
    const session = createSession({ goal: 'Atomic', projectRoot });
    saveSession(session, projectRoot);
    const dir = path.join(projectRoot, '.decode', 'sessions');
    const files = fs.readdirSync(dir);
    expect(files.every((f) => f.endsWith('.json'))).toBe(true);
  });

  it('rejects malformed session files', () => {
    const session = createSession({ goal: 'Bad', projectRoot });
    saveSession(session, projectRoot);
    const dir = path.join(projectRoot, '.decode', 'sessions');
    fs.writeFileSync(path.join(dir, 'corrupt.json'), 'not json');
    const sessions = listSessions(projectRoot);
    expect(sessions.every((s) => s.sessionId !== 'corrupt')).toBe(true);
  });

  it('rejects unsupported session versions', () => {
    const session = createSession({ goal: 'Version', projectRoot });
    saveSession(session, projectRoot);
    const dir = path.join(projectRoot, '.decode', 'sessions');
    const badPath = path.join(dir, `${session.sessionId}.json`);
    const raw = JSON.parse(fs.readFileSync(badPath, 'utf8'));
    raw.version = 999;
    fs.writeFileSync(badPath, JSON.stringify(raw, null, 2));
    expect(() => loadSession(projectRoot, session.sessionId)).toThrow('Unsupported session version');
  });

  it('rejects missing session', () => {
    expect(() => loadSession(projectRoot, 'nonexistent')).toThrow('Session not found');
  });
});

describe('listSessions', () => {
  it('lists valid sessions sorted by updatedAt', () => {
    const a = createSession({ goal: 'A', projectRoot });
    saveSession(a, projectRoot);
    const b = createSession({ goal: 'B', projectRoot });
    saveSession(b, projectRoot);

    const sessions = listSessions(projectRoot);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.sessionId)).toContain(a.sessionId);
    expect(sessions.map((s) => s.sessionId)).toContain(b.sessionId);
    expect(sessions[0].updatedAt >= sessions[1].updatedAt).toBe(true);
  });

  it('returns empty array when directory missing', () => {
    const sessions = listSessions(projectRoot);
    expect(sessions).toEqual([]);
  });
});

describe('session ID sanitization', () => {
  it('rejects empty session IDs in saveSession via path', () => {
    const session = createSession({ goal: 'X', projectRoot });
    session.sessionId = '';
    expect(() => saveSession(session, projectRoot)).toThrow('Invalid session ID');
  });

  it('normalizes special characters in session ID', () => {
    const session = createSession({ goal: 'X', projectRoot });
    session.sessionId = 'my-session/../evil';
    saveSession(session, projectRoot);
    const dir = path.join(projectRoot, '.decode', 'sessions');
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.includes('my-session'))).toBe(true);
  });
});

describe('session data sanitization', () => {
  it('does not persist overly long strings', () => {
    const session = createSession({ goal: 'Long', projectRoot });
    session.history = [{ type: 'text', content: 'x'.repeat(200000), iteration: 1 }];
    saveSession(session, projectRoot);
    const loaded = loadSession(projectRoot, session.sessionId);
    expect(loaded.history[0].content.length).toBeLessThanOrEqual(65536 + 30);
  });
});

describe('deleteSession', () => {
  it('deletes an existing session', () => {
    const session = createSession({ goal: 'Delete', projectRoot });
    saveSession(session, projectRoot);
    expect(() => loadSession(projectRoot, session.sessionId)).not.toThrow();

    deleteSession(projectRoot, session.sessionId);
    expect(() => loadSession(projectRoot, session.sessionId)).toThrow('Session not found');
  });

  it('returns controlled error for missing session', () => {
    expect(() => deleteSession(projectRoot, 'nonexistent')).toThrow('Session not found');
  });

  it('rejects invalid session IDs', () => {
    expect(() => deleteSession(projectRoot, '')).toThrow('Invalid session ID');
    expect(() => deleteSession(projectRoot, '   ')).toThrow('Invalid session ID');
    expect(() => deleteSession(projectRoot, '../etc/passwd')).toThrow('Session not found');
    expect(() => deleteSession(projectRoot, '/absolute/path')).toThrow('Session not found');
  });

  it('does not affect other sessions', () => {
    const a = createSession({ goal: 'A', projectRoot });
    const b = createSession({ goal: 'B', projectRoot });
    saveSession(a, projectRoot);
    saveSession(b, projectRoot);

    deleteSession(projectRoot, a.sessionId);

    expect(() => loadSession(projectRoot, a.sessionId)).toThrow('Session not found');
    expect(() => loadSession(projectRoot, b.sessionId)).not.toThrow();
  });
});
