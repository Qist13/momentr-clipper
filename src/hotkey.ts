// Turns a browser keydown event into an Electron accelerator string such as
// "Ctrl+Shift+S" or "F8". See https://electronjs.org/docs/latest/api/accelerator

// Keys named by event.code that don't follow a simple pattern
const CODE_NAMES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PrintScreen: 'PrintScreen',
  ScrollLock: 'Scrolllock',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

// The key itself (no modifiers), or null for modifier keys and unsupported keys.
// Uses event.code so the result doesn't change with Shift or keyboard layout.
export const keyName = (code: string): string | null => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return CODE_NAMES[code] ?? null;
};

export const modifiers = (event: KeyboardEvent): string[] => {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push('Ctrl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  // Windows key on Windows/Linux, Cmd on macOS
  if (event.metaKey) mods.push('Super');
  return mods;
};

// Keys that are safe as a global hotkey on their own. Anything else (letters,
// Space, arrows...) would stop working for typing in every app, so it needs
// a modifier.
export const worksAlone = (key: string) =>
  /^F\d{1,2}$/.test(key) ||
  key.startsWith('num') ||
  ['PrintScreen', 'Scrolllock', 'Insert'].includes(key);
