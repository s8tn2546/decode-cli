/**
 * src/services/commandSafety.js
 * Reusable command safety validation for DeCode.
 *
 * Used by:
 *  - run_command tool
 *  - --verify custom verification
 *
 * Enforces:
 *  - allowlist-only execution
 *  - dangerous pattern rejection
 *  - no shell injection (shell: false)
 */

const ALLOWED_PREFIXES = [
  'npm test',
  'npm run test',
  'npm run build',
  'npm run lint',
  'npm run dev',
  'node --version',
  'npm --version',
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git remote -v',
];

const DANGEROUS_PATTERNS = [
  /;/, /&&/, /\|\|/, /\|/, /`/, /\$\(/, />/, /</, /rm\b/, /sudo\b/, /chmod\b/, /chown\b/,
  /curl\b/, /wget\b/, /git push\b/, /git reset\b/, /git clean\b/, /npm install\b/,
  /npm uninstall\b/, /yarn add\b/, /pnpm add\b/, /bun install\b/,
];

export function isAllowedCommand(command) {
  const trimmed = command.trim();
  return ALLOWED_PREFIXES.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}

export function containsDangerousPatterns(command) {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

export function validateCommand(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed) {
    return { valid: false, reason: 'Command is empty' };
  }
  if (!isAllowedCommand(trimmed)) {
    return { valid: false, reason: `Command not allowed: ${trimmed}` };
  }
  if (containsDangerousPatterns(trimmed)) {
    return { valid: false, reason: `Command contains dangerous patterns: ${trimmed}` };
  }
  return { valid: true, reason: null };
}

export function parseCommand(command) {
  const trimmed = command.trim();
  const match = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = match[0] || '';
  const args = match.slice(1).map((arg) => arg.replace(/^"(.*)"$/, '$1'));
  return { cmd, args };
}
