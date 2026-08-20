/**
 * src/services/session.js
 * Session persistence for the DeCode Agent.
 *
 * Sessions are stored inside the project at .decode/sessions/<session-id>.json
 * and contain only operational state needed to resume an agent conversation.
 *
 * Security:
 *  - No secrets, API keys, tokens, or environment variables are persisted.
 *  - Session IDs are sanitized to prevent path traversal.
 *  - Session data is validated before loading.
 *  - Atomic writes (temp file + rename) prevent partial/corrupt session files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { truncateToolData } from './agent.js';

const SESSION_DIR = '.decode';
const SESSION_SUBDIR = 'sessions';
const CURRENT_VERSION = 1;

function getSessionDir(projectRoot) {
  return path.join(projectRoot, SESSION_DIR, SESSION_SUBDIR);
}

function sanitizeSessionId(sessionId) {
  const str = String(sessionId || '').trim();
  if (!str) return null;
  const safe = str.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (safe.length > 64) return safe.slice(0, 64);
  return safe;
}

function sessionPath(projectRoot, sessionId) {
  const safeId = sanitizeSessionId(sessionId);
  if (!safeId) {
    throw new Error('Invalid session ID');
  }
  return path.join(getSessionDir(projectRoot), `${safeId}.json`);
}

function validateSessionData(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Session data is not an object' };
  }
  if (typeof raw.version !== 'number' || raw.version !== CURRENT_VERSION) {
    return { valid: false, error: `Unsupported session version: ${raw.version}` };
  }
  if (typeof raw.sessionId !== 'string' || !raw.sessionId) {
    return { valid: false, error: 'Missing sessionId' };
  }
  if (typeof raw.goal !== 'string' || !raw.goal) {
    return { valid: false, error: 'Missing goal' };
  }
  if (typeof raw.projectRoot !== 'string' || !raw.projectRoot) {
    return { valid: false, error: 'Missing projectRoot' };
  }
  if (!Array.isArray(raw.history)) {
    return { valid: false, error: 'Missing or invalid history array' };
  }
  if (!Array.isArray(raw.proposals)) {
    return { valid: false, error: 'Missing or invalid proposals array' };
  }
  if (typeof raw.createdAt !== 'string' || !raw.createdAt) {
    return { valid: false, error: 'Missing createdAt' };
  }
  if (typeof raw.updatedAt !== 'string' || !raw.updatedAt) {
    return { valid: false, error: 'Missing updatedAt' };
  }
  return { valid: true };
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.map((step) => {
    const base = {
      type: step.type,
      iteration: step.iteration,
    };
    if (step.type === 'text') {
      base.content = String(step.content || '').slice(0, 65536);
    } else if (step.type === 'tool_call') {
      base.id = step.id;
      base.name = step.name;
      base.arguments = step.arguments;
      if (step.result) {
        const result = { success: step.result.success };
        if (step.result.error) {
          result.error = step.result.error;
        }
        if (step.result.success && step.result.data !== undefined) {
          result.data = truncateToolData(step.result.data);
        }
        base.result = result;
      }
    }
    return base;
  });
}

function sanitizeProposals(proposals) {
  if (!Array.isArray(proposals)) return [];
  return proposals.map((p) => ({
    path: String(p.path || ''),
    originalContent: p.originalContent ?? null,
    proposedContent: String(p.proposedContent || '').slice(0, 262144),
  }));
}

export function createSession({ goal, projectRoot }) {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    goal: String(goal || ''),
    projectRoot: String(projectRoot || ''),
    history: [],
    proposals: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function saveSession(session, projectRoot) {
  const targetPath = sessionPath(projectRoot, session.sessionId);
  const dir = getSessionDir(projectRoot);

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    throw new Error(`Cannot create session directory: ${dir}`);
  }

  const payload = {
    version: CURRENT_VERSION,
    sessionId: session.sessionId,
    goal: session.goal,
    projectRoot: session.projectRoot,
    history: sanitizeHistory(session.history),
    proposals: sanitizeProposals(session.proposals),
    createdAt: session.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(payload, null, 2);
  const tmpPath = `${targetPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    fs.writeFileSync(tmpPath, json, 'utf8');
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new Error(`Cannot write session file: ${err.message}`);
  }
}

export function loadSession(projectRoot, sessionId) {
  const targetPath = sessionPath(projectRoot, sessionId);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Session not found: ${sessionId}`);
    }
    throw new Error(`Cannot read session file: ${err.message}`);
  }

  const validation = validateSessionData(raw);
  if (!validation.valid) {
    throw new Error(`Invalid session file: ${validation.error}`);
  }

  return {
    version: raw.version,
    sessionId: raw.sessionId,
    goal: raw.goal,
    projectRoot: raw.projectRoot,
    history: raw.history,
    proposals: raw.proposals,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function listSessions(projectRoot) {
  const dir = getSessionDir(projectRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const sessions = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.slice(0, -5);
    const fullPath = path.join(dir, entry);
    try {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (validateSessionData(raw).valid) {
        sessions.push({
          sessionId: raw.sessionId,
          goal: raw.goal,
          updatedAt: raw.updatedAt,
        });
      }
    } catch {
      // skip corrupt session files
    }
  }

  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return sessions;
}

export function deleteSession(projectRoot, sessionId) {
  const safeId = sanitizeSessionId(sessionId);
  if (!safeId) {
    throw new Error('Invalid session ID');
  }
  const targetPath = path.join(getSessionDir(projectRoot), `${safeId}.json`);
  try {
    fs.unlinkSync(targetPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Session not found: ${safeId}`);
    }
    throw new Error(`Cannot delete session: ${err.message}`);
  }
}
