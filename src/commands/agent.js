/**
 * src/commands/agent.js
 * `decode agent` — DeCode Agent (PRD story 5, Phase 4 controlled coding implementation).
 *
 * Forms:
 *  - `decode agent <goal>`        run the agent with a goal
 *  - `decode agent --json`        machine-readable output
 *
 * The agent remains read-only while investigating. Proposed changes are only
 * applied after explicit user approval.
 */

import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { withPrompt, isInInkSession } from '../ui/ink/promptGuard.js';

import { runAgent, MAX_ITERATIONS } from '../services/agent.js';
import {
  generateUnifiedDiff,
  detectConflicts,
  applyProposals,
} from '../services/proposedChange.js';
import { createSession, saveSession, loadSession, listSessions, deleteSession } from '../services/session.js';
import { validateCommand, parseCommand } from '../services/commandSafety.js';
import * as ui from '../ui/index.js';
import * as renderer from '../ui/renderer.js';
import * as output from '../utils/output.js';

const VERIFY_DEFAULT = 'npm test';
const VERIFY_TIMEOUT = 120000;
const VERIFY_OUTPUT_LIMIT = 65536;
const MAX_FIX_ATTEMPTS = 3;

export function agentCommand() {
  return new Command('agent')
    .description('Run the DeCode Agent to accomplish a goal using available tools')
    .argument('[goal]', 'The goal for the agent to accomplish')
    .option('--json', 'Output machine-readable JSON to stdout')
    .option('--verbose', 'Log the exact outgoing LLM request URL and model')
    .option('--verify [command]', 'Run verification tests after applying changes (default: npm test)')
    .option('--verify-timeout <ms>', 'Verification timeout in milliseconds (default: 120000)')
    .option('--fix', 'Enable bounded auto-fix loop after verification failure')
    .option('--session <id>', 'Create or resume a named agent session')
    .option('--resume <id>', 'Resume a previously saved agent session')
    .option('--list-sessions', 'List saved agent sessions')
    .option('--delete-session <id>', 'Delete a saved agent session')
    .action(async (goal, opts) => executeAgent(goal, opts));
}

export { runVerification, listSessions, deleteSession };

export async function executeAgent(goal, opts = {}) {
  try {
    if (opts.fix && !opts.verify) {
      opts.verify = true;
    }

    if (opts.listSessions) {
      const sessions = listSessions(process.cwd());
      if (sessions.length === 0) {
        output.dim('No saved sessions found.');
      } else {
        output.heading('Saved sessions');
        output.plain('');
        for (const session of sessions) {
          output.plain(`  ${session.sessionId}`);
          output.dim(`    Goal: ${session.goal}`);
          output.dim(`    Updated: ${session.updatedAt}`);
          output.plain('');
        }
      }
      return;
    }

    if (opts.deleteSession) {
      try {
        deleteSession(process.cwd(), opts.deleteSession);
        output.success(`Deleted session: ${opts.deleteSession}`);
      } catch (err) {
        output.error(`Cannot delete session: ${err.message}`);
        process.exitCode = 1;
      }
      return;
    }

    const resolvedGoal = await resolveGoal(goal, opts);
    if (!resolvedGoal) return;

    if (opts.json) {
      const result = await runAgent(resolvedGoal, process.cwd(), { verbose: opts.verbose });
      renderer.render(JSON.stringify(result, null, 2));
      return;
    }

    await renderInteractiveAgent(resolvedGoal, opts);
  } catch (err) {
    renderError(err);
    process.exitCode = 1;
  }
}

async function resolveGoal(goal, opts) {
  if (opts.resume) {
    try {
      const session = loadSession(process.cwd(), opts.resume);
      if (session && session.goal) {
        output.dim(`Resumed session: ${opts.resume} — ${session.goal}`);
        return session.goal;
      }
    } catch (err) {
      output.error(`Cannot resume session: ${err.message}`);
      process.exitCode = 1;
      return null;
    }
  }
  if (goal) return goal;
  renderError(new Error('No goal provided. Pass a goal argument: decode agent "your goal"'));
  return null;
}

async function promptForApproval(proposals) {
  const filePaths = proposals.map((p) => p.path);
  const totalAdditions = proposals.reduce((sum, p) => {
    const diff = generateUnifiedDiff(p.originalContent, p.proposedContent, p.path);
    if (!diff) return sum;
    return sum + diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  }, 0);
  const totalDeletions = proposals.reduce((sum, p) => {
    const diff = generateUnifiedDiff(p.originalContent, p.proposedContent, p.path);
    if (!diff) return sum;
    return sum + diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  }, 0);

  output.heading('Proposed changes');
  output.plain('');
  output.dim(`${proposals.length} file(s) changed  |  +${totalAdditions} / -${totalDeletions}`);
  output.plain('');
  output.dim('The following files will be modified:');
  for (const fp of filePaths) {
    output.plain(`  ${fp}`);
  }
  output.plain('');
  output.dim('WARNING: These changes will be written to disk.');
  output.plain('');

  for (const proposal of proposals) {
    const diff = generateUnifiedDiff(proposal.originalContent, proposal.proposedContent, proposal.path);
    if (diff) {
      output.plain(diff);
      output.plain('');
    }
  }

  const { approve } = await withPrompt(() => inquirer.prompt([
    {
      type: 'confirm',
      name: 'approve',
      message: 'Apply these changes?',
      default: false,
    },
  ]));
  return approve;
}

async function renderInteractiveAgent(goal, opts) {
  const isTTY = process.stdout.isTTY;
  const spinner = !isInInkSession() && isTTY ? ora('Agent working...').start() : null;
  const workflow = [];
  let result;
  let verifyResult = null;
  let appliedProposals = [];
  let fixAttempts = 0;
  let cancelled = false;
  try {
    result = await runAgent(goal, process.cwd(), {
      verbose: opts.verbose,
      sessionId: opts.session || opts.resume || undefined,
      onProgress: (event) => {
        if (spinner) {
          spinner.text = event.detail || event.type;
        }
        if (event.type === 'tool_finished' && event.detail) {
          workflow.push({ tool: event.detail, status: 'success' });
        } else if (event.type === 'tool_failed' && event.detail) {
          workflow.push({ tool: event.detail, status: 'failed' });
        }
      },
      onSessionEvent: (event) => {
        if (spinner && event.type === 'session_saved') {
          spinner.text = `Session saved: ${event.detail}`;
        }
        if (spinner && event.type === 'session_loaded') {
          spinner.text = event.detail || 'Session loaded';
        }
      },
    });
  } finally {
    if (spinner) spinner.stop();
  }

  if (!result.success) {
    if (isTTY) {
      renderError(new Error(result.error));
    }
    process.exitCode = 1;
    return;
  }

  if (workflow.length > 0 && isTTY) {
    output.heading('Workflow');
    output.plain('');
    for (const step of workflow) {
      const icon = step.status === 'success' ? '✓' : '✗';
      const color = step.status === 'success' ? 'green' : 'red';
      console.log(chalk[color](`${icon} ${step.tool}`));
    }
    output.plain('');
  }

  const proposals = result.proposals || [];
  if (proposals.length > 0) {
    if (isTTY) {
      output.heading('Proposed changes');
      output.plain('');
      const filePaths = proposals.map((p) => p.path);
      output.dim(`${proposals.length} file(s) changed`);
      output.plain('');
      for (const fp of filePaths) {
        output.plain(`  ${fp}`);
      }
      output.plain('');
    }

    const conflicts = detectConflicts(proposals, process.cwd());
    if (conflicts.length > 0) {
      if (isTTY) {
        output.heading('Cannot apply changes');
        output.plain('');
        for (const conflict of conflicts) {
          output.error(`${conflict.path}: ${conflict.message}`);
        }
        output.plain('');
        output.dim('Files changed since the proposal was generated. Refusing to overwrite.');
      }
      process.exitCode = 1;
      return;
    }

    const approved = await promptForApproval(proposals);
    if (!approved) {
      cancelled = true;
      if (isTTY) {
        output.heading('Changes cancelled');
        output.dim('No files were modified.');
      }
      process.exitCode = 0;
      return;
    }

    const writeResults = applyProposals(proposals, process.cwd());
    const failed = writeResults.filter((r) => !r.success);
    if (failed.length > 0) {
      if (isTTY) {
        output.heading('Write failures');
        output.plain('');
        for (const fail of failed) {
          output.error(`${fail.path}: ${fail.error}`);
        }
        output.plain('');
      }
      process.exitCode = 1;
      return;
    }

    appliedProposals = proposals;
    if (isTTY) {
      output.success(`Applied ${writeResults.length} change(s).`);
      output.plain('');
    }

    const verifyCommand = opts.verify !== false && (opts.verify === true ? VERIFY_DEFAULT : String(opts.verify));
    if (verifyCommand) {
      const verifyTimeout = parseVerifyTimeout(opts.verifyTimeout);
      const vResult = runVerification(process.cwd(), verifyCommand, verifyTimeout);
      if (!vResult.success && opts.fix) {
        const fixResult = await runAutoFixFlow(vResult, verifyCommand, process.cwd(), verifyTimeout, goal, opts, isTTY);
        if (!fixResult.success) {
          process.exitCode = 1;
          return;
        }
        fixAttempts = fixResult.fixAttempts || 0;
        verifyResult = fixResult.verification || { success: true, command: verifyCommand };
      } else {
        verifyResult = await runVerifyFlow(verifyCommand, process.cwd(), verifyTimeout, vResult, isTTY);
        if (verifyResult && !verifyResult.success) {
          process.exitCode = 1;
          return;
        }
      }
    }
  } else if (opts.verify !== false) {
    const verifyCommand = opts.verify === true ? VERIFY_DEFAULT : String(opts.verify);
    if (verifyCommand) {
      const verifyTimeout = parseVerifyTimeout(opts.verifyTimeout);
      const vResult = runVerification(process.cwd(), verifyCommand, verifyTimeout);
      if (!vResult.success && opts.fix) {
        const fixResult = await runAutoFixFlow(vResult, verifyCommand, process.cwd(), verifyTimeout, goal, opts, isTTY);
        if (!fixResult.success) {
          process.exitCode = 1;
          return;
        }
        fixAttempts = fixResult.fixAttempts || 0;
        verifyResult = fixResult.verification || { success: true, command: verifyCommand };
      } else {
        verifyResult = await runVerifyFlow(verifyCommand, process.cwd(), verifyTimeout, vResult, isTTY);
        if (verifyResult && !verifyResult.success) {
          process.exitCode = 1;
          return;
        }
      }
    }
  }

  if (opts.json) {
    const jsonResult = buildJsonResult(result, {
      appliedProposals,
      verifyResult,
      fixAttempts,
      cancelled,
    });
    renderer.render(JSON.stringify(jsonResult, null, 2));
    return;
  }

  renderFinalSummary(goal, result, {
    proposals,
    appliedProposals,
    verifyResult,
    fixAttempts,
    cancelled,
    isTTY,
  });
}

function buildJsonResult(result, metadata) {
  return {
    success: result.success,
    response: result.response || '',
    steps: result.steps?.length || 0,
    toolCalls: (result.steps || []).filter((s) => s.type === 'tool_call').length,
    proposals: (result.proposals || []).map((p) => ({
      path: p.path,
      originalContent: p.originalContent,
      proposedContent: p.proposedContent,
    })),
    appliedProposals: metadata.appliedProposals.map((p) => p.path),
    verification: metadata.verifyResult
      ? {
          attempted: true,
          success: metadata.verifyResult.success,
          command: metadata.verifyResult.command,
          exitCode: metadata.verifyResult.exitCode,
        }
      : { attempted: false },
    sessionId: result.session?.sessionId || null,
    fixAttempts: metadata.fixAttempts,
    cancelled: metadata.cancelled,
    error: result.error || null,
  };
}

function renderFinalSummary(goal, result, metadata) {
  const { proposals, appliedProposals, verifyResult, fixAttempts, cancelled, isTTY } = metadata;
  const toolCalls = (result.steps || []).filter((s) => s.type === 'tool_call');

  const answerBlock = ui.panel({
    title: 'Agent Answer',
    content: result.response,
    width: 70,
    borderColor: 'green',
  });

  const meta = [];
  meta.push(`${ui.statusDot('pass')}  ${result.steps?.length || 0} step(s)`);
  meta.push(`${ui.statusDot('pass')}  ${toolCalls.length} tool call(s)`);
  if (appliedProposals.length > 0) {
    meta.push(`${ui.statusDot('pass')}  ${appliedProposals.length} proposed change(s) applied`);
  }
  if (verifyResult) {
    const verifyIcon = verifyResult.success ? 'pass' : 'fail';
    const verifyLabel = verifyResult.success ? 'Verification passed' : 'Verification failed';
    meta.push(`${ui.statusDot(verifyIcon)}  ${verifyLabel}: ${verifyResult.command || 'npm test'}`);
  }
  if (fixAttempts > 0) {
    meta.push(`${ui.statusDot('pass')}  Fix attempts: ${fixAttempts}`);
  }
  if (result.session?.sessionId) {
    const sessionLabel = result.session.sessionId.includes('resumed') ? 'Resumed' : 'Session';
    meta.push(`${ui.statusDot('pass')}  ${sessionLabel}: ${result.session.sessionId}`);
  }

  const content = [answerBlock, '', '', meta.join('\n')].join('\n');

  renderer.render({
    command: 'decode agent',
    context: '— read-only agent',
    content,
  });
}

function parseVerifyTimeout(raw) {
  if (raw === undefined || raw === null || raw === '') return VERIFY_TIMEOUT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid verify timeout: ${raw}. Must be a positive integer.`);
  }
  return parsed;
}

async function runVerifyFlow(verifyCommand, projectRoot, verifyTimeout = VERIFY_TIMEOUT, precomputedResult, isTTY = true) {
  if (isTTY) {
    output.heading('Verifying changes');
    output.plain('');
  }
    const verifySpinner = !isInInkSession() && isTTY ? ora('Running verification...').start() : null;
  let verifyResult = precomputedResult;
  if (!verifyResult) {
    try {
      verifyResult = runVerification(projectRoot, verifyCommand, verifyTimeout);
    } finally {
      if (verifySpinner) verifySpinner.stop();
    }
  }

  if (isTTY) {
    output.plain('');
  }
  if (verifyResult.success) {
    if (isTTY) {
      output.success('Verification passed.');
      output.plain('');
    }
  } else {
    if (isTTY) {
      output.error('Verification failed.');
      output.plain(verifyResult.error || 'Unknown error');
    }
    process.exitCode = 1;
    return verifyResult;
  }
  return verifyResult;
}

async function runAutoFixFlow(verifyResult, verifyCommand, projectRoot, verifyTimeout, originalGoal, opts, isTTY = true) {
  if (isTTY) {
    output.heading('Auto-fix mode');
    output.plain('');
  }

  let attempt = 0;
  let currentResult = verifyResult;

  while (attempt < MAX_FIX_ATTEMPTS) {
    if (currentResult.success) {
      if (isTTY) {
        output.success('Verification passed.');
        output.plain('');
      }
      return { success: true, fixAttempts: attempt, verification: currentResult };
    }

    attempt++;
    if (isTTY) {
      output.dim(`Fix attempt ${attempt} of ${MAX_FIX_ATTEMPTS}`);
      output.plain('');
    }

    const diagnosticContext = [
      `Command: ${verifyCommand}`,
      `Exit code: ${currentResult.exitCode}`,
      '',
      'Failure output:',
      truncateOutput(currentResult.stderr || '', VERIFY_OUTPUT_LIMIT),
    ].join('\n');

    const fixGoal = `Verification failed.\n\n${diagnosticContext}\n\nInvestigate the failure and propose the smallest safe fix. Do not modify files directly. Use propose_change to describe any changes.`;

    const fixSpinner = !isInInkSession() && isTTY ? ora('Agent investigating failure...').start() : null;
    let fixResult;
    try {
      fixResult = await runAgent(fixGoal, projectRoot, {
        cwd: process.cwd(),
        verbose: opts.verbose,
        sessionId: opts.session || opts.resume || undefined,
        onProgress: (event) => {
          if (fixSpinner) {
            fixSpinner.text = event.detail || event.type;
          }
        },
        onSessionEvent: (event) => {
          if (fixSpinner && event.type === 'session_saved') {
            fixSpinner.text = `Session saved: ${event.detail}`;
          }
          if (fixSpinner && event.type === 'session_loaded') {
            fixSpinner.text = event.detail || 'Session loaded';
          }
        },
      });
    } finally {
      if (fixSpinner) fixSpinner.stop();
    }

    if (!fixResult.success) {
      if (isTTY) {
        output.error('Agent failed to investigate the failure.');
        output.plain(fixResult.error || 'Unknown error');
      }
      return { success: false, fixAttempts: attempt, verification: currentResult };
    }

    const fixProposals = fixResult.proposals || [];
    if (fixProposals.length === 0) {
      if (isTTY) {
        output.error('Verification failed, but no safe fix was proposed.');
      }
      return { success: false, fixAttempts: attempt, verification: currentResult };
    }

    const conflicts = detectConflicts(fixProposals, projectRoot);
    if (conflicts.length > 0) {
      if (isTTY) {
        output.heading('Cannot apply fix');
        output.plain('');
        for (const conflict of conflicts) {
          output.error(`${conflict.path}: ${conflict.message}`);
        }
        output.plain('');
        output.dim('Files changed since the fix was proposed. Refusing to overwrite.');
      }
      return { success: false, fixAttempts: attempt, verification: currentResult };
    }

    const approved = await promptForApproval(fixProposals);
    if (!approved) {
      if (isTTY) {
        output.heading('Fix cancelled');
        output.dim('No files were modified.');
      }
      return { success: false, fixAttempts: attempt, verification: currentResult, cancelled: true };
    }

    const writeResults = applyProposals(fixProposals, projectRoot);
    const failed = writeResults.filter((r) => !r.success);
    if (failed.length > 0) {
      if (isTTY) {
        output.heading('Write failures');
        output.plain('');
        for (const fail of failed) {
          output.error(`${fail.path}: ${fail.error}`);
        }
        output.plain('');
      }
      return { success: false, fixAttempts: attempt, verification: currentResult };
    }

    if (isTTY) {
      output.success(`Applied ${writeResults.length} fix change(s).`);
      output.plain('');
    }

    currentResult = runVerification(projectRoot, verifyCommand, verifyTimeout);
  }

  if (isTTY) {
    output.error(`Verification failed after ${MAX_FIX_ATTEMPTS} fix attempts.`);
    output.plain('');
  }
  return { success: false, fixAttempts: MAX_FIX_ATTEMPTS, verification: currentResult };
}

function renderError(err) {
  const error = ui.errorPrompt({
    type: 'Agent failed',
    explanation: err.message || 'An unexpected error occurred.',
    actions: [
      { command: 'decode status', description: 'check configuration' },
      { command: 'decode init', description: 'connect an LLM provider' },
    ],
  });

  renderer.render({
    type: 'error',
    command: 'decode agent',
    error,
  });
}

function sanitizeError(message) {
  const str = String(message || '');
  if (str.includes('API key') || str.includes('api_key') || str.includes('token')) {
    return 'Authentication or configuration error. Check your LLM provider settings.';
  }
  if (str.includes('ENOENT') || str.includes('spawnSync')) {
    return 'Command could not be executed. Check that the required tool is available.';
  }
  if (str.includes('realpath')) {
    return 'Path security check failed. The requested path may be outside the project.';
  }
  if (str.includes('EACCES') || str.includes('EPERM')) {
    return 'Permission denied. The agent cannot access the requested resource.';
  }
  return str;
}

function truncateOutput(raw, limit = VERIFY_OUTPUT_LIMIT) {
  const str = String(raw || '');
  if (str.length <= limit) return str;
  return str.slice(0, limit) + '\n... [output truncated]';
}

function runVerification(projectRoot, command = VERIFY_DEFAULT, timeout = VERIFY_TIMEOUT) {
  const safety = validateCommand(command);
  if (!safety.valid) {
    return {
      success: false,
      command,
      exitCode: 1,
      error: `Verification command not allowed: ${safety.reason}`,
    };
  }

  const { cmd, args } = parseCommand(command);

  try {
    const result = spawnSync(cmd, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const exitCode = result.status != null ? result.status : 1;
    const stdout = truncateOutput(result.stdout || '');
    const stderr = truncateOutput(result.stderr || '');

    if (exitCode === 0) {
      return { success: true, command, exitCode, stdout, stderr };
    }

    const errorLines = [];
    if (stderr) errorLines.push(stderr.trim());
    if (stdout) errorLines.push(stdout.trim());
    const rawError = errorLines.filter(Boolean).join('\n') || `${command} exited with code ${exitCode}`;
    return {
      success: false,
      command,
      exitCode,
      stdout,
      stderr,
      error: sanitizeError(rawError),
    };
  } catch (err) {
    return {
      success: false,
      command,
      exitCode: 1,
      error: sanitizeError(err.message || 'Verification command failed'),
    };
  }
}
