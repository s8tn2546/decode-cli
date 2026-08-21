/**
 * Routes renderer/terminal output into the Ink message log while a REPL
 * command is running. Avoids patching process.stdout.write, which would
 * swallow Ink's own frame updates and corrupt the terminal.
 */

let sink = null;

export function beginOutputCapture(onLine) {
  sink = onLine;
}

export function endOutputCapture() {
  sink = null;
}

export function isCapturingOutput() {
  return sink !== null;
}

export function pushCapturedOutput(text) {
  if (!sink || text === undefined || text === null) return;
  const str = String(text);
  if (!str) return;
  for (const line of str.split('\n')) {
    sink(line);
  }
}
