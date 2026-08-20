/**
 * src/services/agent.js
 * DeCode Agent orchestrator — the minimum real agent loop for read-only goals.
 *
 * Responsibilities:
 *  - Convert registered READ_ONLY tool definitions into the provider schema.
 *  - Maintain minimal conversation state across turns.
 *  - Drive the loop: LLM -> tool call -> ToolExecutor -> observation -> LLM.
 *  - Enforce a hard iteration cap to prevent runaway loops.
 *
 * This module does not expose any write/execute/git tools, does not bypass
 * ToolExecutor, and does not execute tools directly.
 */

import { generateSummary, isLlmConfigured } from './llmClient.js';
import { readConfig } from './configStore.js';
import { listTools, getTool, Permission } from './toolRegistry.js';
import { ToolExecutor } from './toolExecutor.js';
import { registerBuiltinTools } from './tools.js';
import { AGENT_SYSTEM_PROMPT } from './agentPrompt.js';
import { ProposedChange } from './proposedChange.js';
import { createSession, saveSession, loadSession } from './session.js';

export const MAX_ITERATIONS = 10;
export const MAX_HISTORY_SIZE = 50;
export const MAX_TOOL_OUTPUT_SIZE = 65536;
export const MAX_TOOL_CALLS_PER_ITERATION = 5;
export const MAX_PROPOSED_FILES = 10;
export const MAX_PROPOSAL_SIZE = 262144;
export const MAX_RETRIES_PER_TOOL = 1;

let idCounter = 0;

function generateId() {
  idCounter += 1;
  return `call_${Date.now()}_${idCounter}`;
}

function truncateToolOutput(raw) {
  const str = String(raw || '');
  if (str.length <= MAX_TOOL_OUTPUT_SIZE) return str;
  return str.slice(0, MAX_TOOL_OUTPUT_SIZE) + '\n... [output truncated]';
}

export function truncateToolData(data) {
  if (typeof data === 'string') {
    return truncateToolOutput(data);
  }
  if (Array.isArray(data)) {
    return data.map(truncateToolData);
  }
  if (data && typeof data === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = truncateToolData(value);
    }
    return out;
  }
  return data;
}

function truncateProposalContent(content) {
  const str = String(content || '');
  if (str.length <= MAX_PROPOSAL_SIZE) return str;
  return str.slice(0, MAX_PROPOSAL_SIZE) + '\n... [proposal truncated]';
}

/**
 * Convert registered tool definitions into the provider schema.
 * All non-WRITE tools are exposed — write tools are never sent to the LLM.
 * @returns {Array<object>}
 */
function buildToolSchemas() {
  return listTools()
    .filter((t) => t.permission !== Permission.WRITE)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
}

/**
 * Build the full messages array for a multi-turn conversation.
 *
 * Provider-specific formatting is applied so Anthropic receives tool_result
 * blocks in user messages, while OpenAI-compatible providers receive tool
 * role messages.
 *
 * @param {string} goal
 * @param {Array} history
 * @param {string} provider
 * @returns {Array<{role:string,content:*}>}
 */
function buildMessages(goal, history, provider) {
  const messages = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: `Goal: ${goal}` },
  ];

  for (const step of history) {
    if (step.type === 'proposal') {
      if (provider === 'anthropic') {
        messages.push({
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: step.id,
              name: 'propose_change',
              input: { path: step.path, proposedContent: step.proposedContent },
            },
          ],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: step.id,
              content: JSON.stringify({
                success: true,
                data: {
                  path: step.path,
                  originalContent: step.originalContent,
                  proposedContent: step.proposedContent,
                },
              }),
            },
          ],
        });
      } else {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: step.id,
              type: 'function',
              function: {
                name: 'propose_change',
                arguments: JSON.stringify({ path: step.path, proposedContent: step.proposedContent }),
              },
            },
          ],
        });
        messages.push({
          role: 'tool',
          content: JSON.stringify({
            success: true,
            data: {
              path: step.path,
              originalContent: step.originalContent,
              proposedContent: step.proposedContent,
            },
          }),
          tool_call_id: step.id,
        });
      }
    } else if (step.type === 'tool_call') {
      if (provider === 'anthropic') {
        messages.push({
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: step.id,
              name: step.name,
              input: step.arguments,
            },
          ],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: step.id,
              content: JSON.stringify(step.result),
            },
          ],
        });
      } else {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: step.id,
              type: 'function',
              function: {
                name: step.name,
                arguments: JSON.stringify(step.arguments),
              },
            },
          ],
        });
        messages.push({
          role: 'tool',
          content: JSON.stringify(step.result),
          tool_call_id: step.id,
        });
      }
    } else if (step.type === 'text') {
      messages.push({ role: 'assistant', content: step.content });
    }
  }

  return messages;
}

/**
 * Extract approved proposals from agent history.
 * Enforces limits on proposal count and size.
 * @param {Array} history
 * @returns {Array<ProposedChange>}
 */
function extractProposals(history) {
  const proposals = history
    .filter((s) => s.type === 'tool_call' && s.name === 'propose_change' && s.result && s.result.success)
    .map((s) => {
      const data = s.result.data;
      return new ProposedChange({
        path: data.path,
        originalContent: data.originalContent,
        proposedContent: truncateProposalContent(data.proposedContent),
      });
    });

  if (proposals.length > MAX_PROPOSED_FILES) {
    return proposals.slice(0, MAX_PROPOSED_FILES);
  }
  return proposals;
}

/**
 * Run the agent loop for a single user goal.
 *
 * @param {string} goal
 * @param {string} projectRoot
 * @param {{ cwd?: string, fetchImpl?: typeof fetch, maxTokens?: number, verbose?: boolean, maxIterations?: number, onProgress?: (event: { type: string, detail?: string }) => void, sessionId?: string, onSessionEvent?: (event: { type: string, detail?: string }) => void }} [options={}]
 * @returns {{ success: boolean, response?: string, error?: string, steps: Array, proposals: Array<ProposedChange>, session?: object, appliedProposals?: Array<ProposedChange>, verification?: object, fixAttempts?: number, cancelled?: boolean }}
 */
export async function runAgent(goal, projectRoot, options = {}) {
  const {
    cwd,
    fetchImpl,
    maxTokens,
    verbose,
    maxIterations = MAX_ITERATIONS,
    onProgress,
    sessionId,
    onSessionEvent,
  } = options;

  function progress(type, detail) {
    if (typeof onProgress === 'function') {
      onProgress({ type, detail });
    }
  }

  function sessionEvent(type, detail) {
    if (typeof onSessionEvent === 'function') {
      onSessionEvent({ type, detail });
    }
  }

  function toolProgress(toolName, result) {
    if (typeof onProgress === 'function') {
      const status = result && result.success ? 'finished' : 'failed';
      onProgress({ type: `tool_${status}`, detail: toolName });
    }
  }

  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    return { success: false, error: 'A goal is required', steps: [], proposals: [], cancelled: false };
  }

  if (!isLlmConfigured({ cwd })) {
    return {
      success: false,
      error: 'No LLM provider configured. Run `decode init` to connect your LLM provider.',
      steps: [],
      proposals: [],
      cancelled: false,
    };
  }

  registerBuiltinTools();

  const readOnlyTools = listTools().filter((t) => t.permission === Permission.READ_ONLY);
  if (readOnlyTools.length === 0) {
    return { success: false, error: 'No read-only tools available', steps: [], proposals: [], cancelled: false };
  }

  const config = readConfig({ cwd });
  const provider = config.llm.provider || 'other';
  const executor = new ToolExecutor(String(projectRoot || process.cwd()).replace(/\/+$/, ''));
  const history = [];
  const seenToolCalls = new Set();
  const retryCount = new Map();
  let iteration = 0;

  let session = null;
  if (sessionId) {
    try {
      session = loadSession(projectRoot, sessionId);
      if (session && session.history) {
        history.push(...session.history);
        sessionEvent('session_loaded', `Resumed session: ${sessionId}`);
      }
    } catch (err) {
      sessionEvent('session_loaded', `Failed to resume session: ${err.message}`);
    }
  }

  if (!session) {
    session = createSession({ goal, projectRoot });
  }

  while (iteration < maxIterations) {
    iteration += 1;
    const tools = buildToolSchemas();
    const messages = buildMessages(goal, history, provider);

    try {
      progress('thinking', `Step ${iteration}`);
      const response = await generateSummary('', {
        cwd,
        fetchImpl,
        maxTokens,
        verbose,
        tools,
        messages,
      });

      if (typeof response === 'string') {
        history.push({ type: 'text', content: response, iteration });
        const proposals = extractProposals(history);
        session.history = history;
        session.proposals = proposals.map((p) => ({
          path: p.path,
          originalContent: p.originalContent,
          proposedContent: p.proposedContent,
        }));
        try {
          saveSession(session, projectRoot);
          sessionEvent('session_saved', session.sessionId);
        } catch {}
        return { success: true, response, steps: history, proposals, session, cancelled: false };
      }

      if (response && response.type === 'tool_call') {
        const toolName = response.name;
        const toolArgs = response.arguments || {};
        progress('tool', `Running ${toolName}`);

        if (!getTool(toolName)) {
          history.push({
            type: 'tool_call',
            id: generateId(),
            name: toolName,
            arguments: toolArgs,
            result: {
              success: false,
              error: { message: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' },
            },
            iteration,
          });
          continue;
        }

        const retries = retryCount.get(toolName) || 0;
        if (retries >= MAX_RETRIES_PER_TOOL) {
          history.push({
            type: 'tool_call',
            id: generateId(),
            name: toolName,
            arguments: toolArgs,
            result: {
              success: false,
              error: { message: `Retry limit exceeded for ${toolName}`, code: 'RETRY_LIMIT_EXCEEDED' },
            },
            iteration,
          });
          continue;
        }

        const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
        if (seenToolCalls.has(callKey)) {
          history.push({
            type: 'tool_call',
            id: generateId(),
            name: toolName,
            arguments: toolArgs,
            result: {
              success: false,
              error: { message: `Repeated tool call detected: ${toolName}`, code: 'REPEATED_CALL' },
            },
            iteration,
          });
          continue;
        }
        seenToolCalls.add(callKey);

        const result = await executor.execute(toolName, toolArgs, { projectRoot });
        if (result.success) {
          result.data = truncateToolData(result.data);
        }
        toolProgress(toolName, result);
        history.push({
          type: 'tool_call',
          id: generateId(),
          name: toolName,
          arguments: toolArgs,
          result,
          iteration,
        });
        if (history.length > MAX_HISTORY_SIZE) {
          history.splice(0, history.length - MAX_HISTORY_SIZE);
        }

        if (!result.success) {
          retryCount.set(toolName, retries + 1);
        }
        continue;
      }

      if (response && response.type === 'tool_calls' && Array.isArray(response.calls)) {
        if (response.calls.length > MAX_TOOL_CALLS_PER_ITERATION) {
          history.push({
            type: 'text',
            content: '',
            iteration,
          });
          const proposals = extractProposals(history);
          session.history = history;
          session.proposals = proposals.map((p) => ({
            path: p.path,
            originalContent: p.originalContent,
            proposedContent: p.proposedContent,
          }));
          try {
            saveSession(session, projectRoot);
            sessionEvent('session_saved', session.sessionId);
          } catch {}
          return {
            success: true,
            response: `Too many tool calls (${response.calls.length}). Maximum allowed per iteration is ${MAX_TOOL_CALLS_PER_ITERATION}.`,
            steps: history,
            proposals,
            session,
            cancelled: false,
          };
        }

        progress('tool', `Running ${response.calls.length} tool(s)`);
        for (const call of response.calls) {
          const toolName = call.name;
          const toolArgs = call.arguments || {};
          progress('tool', `Running ${toolName}`);

          if (!getTool(toolName)) {
            toolProgress(toolName, { success: false });
            history.push({
              type: 'tool_call',
              id: generateId(),
              name: toolName,
              arguments: toolArgs,
              result: {
                success: false,
                error: { message: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' },
              },
              iteration,
            });
            continue;
          }

          const retries = retryCount.get(toolName) || 0;
          if (retries >= MAX_RETRIES_PER_TOOL) {
            toolProgress(toolName, { success: false });
            history.push({
              type: 'tool_call',
              id: generateId(),
              name: toolName,
              arguments: toolArgs,
              result: {
                success: false,
                error: { message: `Retry limit exceeded for ${toolName}`, code: 'RETRY_LIMIT_EXCEEDED' },
              },
              iteration,
            });
            continue;
          }

          const callKey = `${toolName}:${JSON.stringify(toolArgs)}`;
          if (seenToolCalls.has(callKey)) {
            toolProgress(toolName, { success: false });
            history.push({
              type: 'tool_call',
              id: generateId(),
              name: toolName,
              arguments: toolArgs,
              result: {
                success: false,
                error: { message: `Repeated tool call detected: ${toolName}`, code: 'REPEATED_CALL' },
              },
              iteration,
            });
            continue;
          }
          seenToolCalls.add(callKey);

          const result = await executor.execute(toolName, toolArgs, { projectRoot });
          if (result.success) {
            result.data = truncateToolData(result.data);
          }
          toolProgress(toolName, result);
          history.push({
            type: 'tool_call',
            id: generateId(),
            name: toolName,
            arguments: toolArgs,
            result,
            iteration,
          });

          if (!result.success) {
            retryCount.set(toolName, retries + 1);
          }
        }
        if (history.length > MAX_HISTORY_SIZE) {
          history.splice(0, history.length - MAX_HISTORY_SIZE);
        }
        continue;
      }

      history.push({ type: 'text', content: '', iteration });
      const proposals = extractProposals(history);
      session.history = history;
      session.proposals = proposals.map((p) => ({
        path: p.path,
        originalContent: p.originalContent,
        proposedContent: p.proposedContent,
      }));
      try {
        saveSession(session, projectRoot);
        sessionEvent('session_saved', session.sessionId);
      } catch {}
      return { success: true, response: '', steps: history, proposals, session, cancelled: false };
    } catch (err) {
      session.history = history;
      session.proposals = [];
      try {
        saveSession(session, projectRoot);
        sessionEvent('session_saved', session.sessionId);
      } catch {}
      return { success: false, error: sanitizeError(err.message || 'Agent execution failed'), steps: history, proposals: [], session, cancelled: false };
    }
  }

  progress('limit', `Stopped after ${maxIterations} iterations`);
  session.history = history;
  session.proposals = extractProposals(history).map((p) => ({
    path: p.path,
    originalContent: p.originalContent,
    proposedContent: p.proposedContent,
  }));
  try {
    saveSession(session, projectRoot);
    sessionEvent('session_saved', session.sessionId);
  } catch {}
  return { success: false, error: `Agent stopped after ${maxIterations} iterations`, steps: history, proposals: extractProposals(history), session, cancelled: false };
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
