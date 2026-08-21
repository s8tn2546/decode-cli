/**
 * src/ui/terminal.js
 * Terminal capability detection and abstraction layer.
 *
 * Philosophy: Never assume terminal capabilities. Detect, fallback gracefully.
 * Abstract raw terminal access so the rest of the system stays clean.
 */
import { isCapturingOutput, pushCapturedOutput } from './ink/outputCapture.js';

/**
 * Detect if we're in a TTY environment.
 * @returns {boolean}
 */
export function isTTY() {
  return Boolean(process.stdout.isTTY);
}

/**
 * Get terminal dimensions.
 * @returns {{ width: number, height: number }}
 */
export function getDimensions() {
  if (isTTY() && process.stdout.columns && process.stdout.rows) {
    return {
      width: process.stdout.columns,
      height: process.stdout.rows,
    };
  }

  // Fallback to standard dimensions
  return {
    width: 80,
    height: 24,
  };
}

/**
 * Get terminal width.
 * @returns {number}
 */
export function getWidth() {
  return getDimensions().width;
}

/**
 * Get terminal height.
 * @returns {number}
 */
export function getHeight() {
  return getDimensions().height;
}

/**
 * Listen for terminal resize events.
 * @param {Function} callback - Called with new dimensions
 * @returns {Function} - Cleanup function to remove listener
 */
export function onResize(callback) {
  if (!isTTY()) {
    return () => {}; // No-op cleanup
  }

  const handler = () => {
    callback(getDimensions());
  };

  process.stdout.on('resize', handler);

  return () => {
    process.stdout.off('resize', handler);
  };
}

/**
 * Detect if terminal supports Unicode.
 * @returns {boolean}
 */
export function supportsUnicode() {
  // Check environment variables that indicate Unicode support
  const env = process.env;

  if (env.TERM_PROGRAM === 'Apple_Terminal') return true;
  if (env.TERM_PROGRAM === 'iTerm.app') return true;
  if (env.TERM_PROGRAM === 'Hyper') return true;
  if (env.TERM_PROGRAM === 'vscode') return true;

  // Check locale
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  if (/utf-?8/i.test(locale)) return true;

  // Conservative default
  return false;
}

/**
 * Detect if terminal supports 256 colors.
 * @returns {boolean}
 */
export function supports256Colors() {
  if (!isTTY()) return false;

  const term = process.env.TERM || '';
  if (term.includes('256')) return true;
  if (term.includes('24bit')) return true;
  if (term.includes('truecolor')) return true;

  const colorTerm = process.env.COLORTERM || '';
  if (colorTerm === 'truecolor') return true;
  if (colorTerm === '24bit') return true;

  return false;
}

/**
 * Detect if terminal supports true color (16 million colors).
 * @returns {boolean}
 */
export function supportsTrueColor() {
  if (!isTTY()) return false;

  const colorTerm = process.env.COLORTERM || '';
  if (colorTerm === 'truecolor') return true;
  if (colorTerm === '24bit') return true;

  const term = process.env.TERM || '';
  if (term.includes('24bit')) return true;
  if (term.includes('truecolor')) return true;

  return false;
}

/**
 * Detect terminal capabilities as a capabilities object.
 * @returns {object}
 */
export function getCapabilities() {
  const dims = getDimensions();

  return {
    isTTY: isTTY(),
    width: dims.width,
    height: dims.height,
    unicode: supportsUnicode(),
    colors256: supports256Colors(),
    trueColor: supportsTrueColor(),
    interactive: isTTY() && Boolean(process.stdin.isTTY),
  };
}

/**
 * Write to stdout without newline.
 * @param {string} text
 */
export function write(text) {
  if (isCapturingOutput()) {
    pushCapturedOutput(text);
    return;
  }
  process.stdout.write(text);
}

/**
 * Write to stdout with newline.
 * @param {string} text
 */
export function writeLine(text = '') {
  if (isCapturingOutput()) {
    pushCapturedOutput(text);
    return;
  }
  process.stdout.write(text + '\n');
}

/**
 * Write to stderr.
 * @param {string} text
 */
export function writeError(text) {
  process.stderr.write(text + '\n');
}

/**
 * Clear the current line.
 */
export function clearLine() {
  if (isTTY()) {
    write('\r\x1b[K');
  }
}

/**
 * Clear the entire screen.
 */
export function clearScreen() {
  if (isTTY()) {
    write('\x1b[2J\x1b[0;0H');
  }
}

/**
 * Move cursor up N lines.
 * @param {number} lines
 */
export function moveCursorUp(lines = 1) {
  if (isTTY() && lines > 0) {
    write(`\x1b[${lines}A`);
  }
}

/**
 * Move cursor down N lines.
 * @param {number} lines
 */
export function moveCursorDown(lines = 1) {
  if (isTTY() && lines > 0) {
    write(`\x1b[${lines}B`);
  }
}

/**
 * Move cursor to start of line.
 */
export function moveCursorToStart() {
  if (isTTY()) {
    write('\r');
  }
}

/**
 * Hide cursor.
 */
export function hideCursor() {
  if (isTTY()) {
    write('\x1b[?25l');
  }
}

/**
 * Show cursor.
 */
export function showCursor() {
  if (isTTY()) {
    write('\x1b[?25h');
  }
}

/**
 * Save cursor position.
 */
export function saveCursor() {
  if (isTTY()) {
    write('\x1b[s');
  }
}

/**
 * Restore cursor position.
 */
export function restoreCursor() {
  if (isTTY()) {
    write('\x1b[u');
  }
}

/**
 * Enable alternative screen buffer (full-screen apps).
 */
export function enableAltScreen() {
  if (isTTY()) {
    write('\x1b[?1049h');
  }
}

/**
 * Disable alternative screen buffer.
 */
export function disableAltScreen() {
  if (isTTY()) {
    write('\x1b[?1049l');
  }
}

/**
 * Get a fallback symbol when Unicode is not supported.
 * @param {string} unicode - Preferred Unicode symbol
 * @param {string} fallback - ASCII fallback
 * @returns {string}
 */
export function getSymbol(unicode, fallback) {
  return supportsUnicode() ? unicode : fallback;
}

export default {
  isTTY,
  getDimensions,
  getWidth,
  getHeight,
  onResize,
  supportsUnicode,
  supports256Colors,
  supportsTrueColor,
  getCapabilities,
  write,
  writeLine,
  writeError,
  clearLine,
  clearScreen,
  moveCursorUp,
  moveCursorDown,
  moveCursorToStart,
  hideCursor,
  showCursor,
  saveCursor,
  restoreCursor,
  enableAltScreen,
  disableAltScreen,
  getSymbol,
};
