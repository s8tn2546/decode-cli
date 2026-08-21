/**
 * src/ui/ink/promptGuard.js
 * Coordinates inquirer prompts with the Ink render loop.
 *
 * When an interactive command (e.g. /init, /github connect, /doc, /config reset)
 * is about to fire an inquirer prompt, it calls `withPrompt()`. App.jsx registers
 * Ink's `suspendTerminal` via `registerPromptGuard`, which hands the terminal to
 * inquirer and restores Ink's input/rendering state afterward.
 *
 * Outside the Ink TTY session (readline path, non-TTY, or first-run /init that runs
 * before Ink starts) nothing is registered, so withPrompt is a harmless pass-through.
 */

let suspendTerminalFn = null;

export function registerPromptGuard(callbacks) {
  suspendTerminalFn = callbacks.suspendTerminal ?? null;
}

/**
 * True only while the Ink TTY session is active (App.jsx has registered the
 * prompt guard). Used by commands to avoid firing a direct-to-stdout spinner
 * that would fight Ink's renderer. Outside Ink (readline/non-TTY) this is false.
 */
export function isInInkSession() {
  return suspendTerminalFn !== null;
}

/** Run `fn` (which triggers an inquirer prompt) while Ink yields the terminal. */
export async function withPrompt(fn) {
  process.stderr.write(`[TRACE] withPrompt enter, registered=${!!suspendTerminalFn}\n`);
  if (!suspendTerminalFn) return fn();
  // Ink's suspendTerminal(callback) resolves to undefined by design, so the
  // prompt's answers must be captured through the closure and returned here.
  let result;
  try {
    await suspendTerminalFn(async () => { result = await fn(); });
  } catch (e) {
    process.stderr.write(`[TRACE] withPrompt handler threw: ${e.message}\n`);
    throw e;
  }
  process.stderr.write(`[TRACE] withPrompt done, keys=${result ? Object.keys(result) : result}\n`);
  return result;
}
