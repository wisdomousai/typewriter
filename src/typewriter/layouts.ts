/**
 * What the keys say. The machine has the same 46 character keys whatever it types, in four
 * rows of 11, 12, 12 and 11 (an ISO board: the bottom row has a key left of the first
 * letter), so a layout is just what each of those keys types: plain, with Shift and with
 * Alt Gr. The legends on the caps are drawn from it, and every character it has gets its
 * own typebar; anything else is struck by the nearest bar.
 *
 * A key is written as the characters it types, in that order: '7/{' types 7, / with Shift
 * and { with Alt Gr. A lone letter types its capital with Shift ('q' is 'qQ').
 *
 * `follow` says how the computer's keyboard drives it. 'character' (the usual) types what
 * you type, wherever it is on this machine. 'position' types whatever this machine has on
 * the key in the same place as the one you pressed: how a keyboard of emoji is typed on.
 */
export interface Layout {
  name: string;
  /** Rows from the number row down; each key a string as above. */
  rows: [string[], string[], string[], string[]];
  follow?: 'character' | 'position';
}

/** The machine's key positions, row by row (bones key_r1k4 and bar_r1k4 in the model). */
export const POSITIONS = [11, 12, 12, 11].map((n, r) =>
  Array.from({ length: n }, (_, k) => `r${r}k${k}`),
);

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const split = (s: string) => [...graphemes.segment(s)].map((g) => g.segment);

/** A key's characters: plain, Shift, Alt Gr (missing ones are left out). */
export function keyChars(key: string): string[] {
  const chars = split(key);
  if (chars.length === 1 && /^\p{Ll}$/u.test(chars[0])) chars.push(chars[0].toUpperCase());
  return chars;
}

const letters = (s: string) => s.split('');

export const LAYOUTS = {
  'de-qwertz': {
    name: 'QWERTZ (German)',
    rows: [
      ['1!', '2"²', '3§³', '4$', '5%', '6&', '7/{', '8([', '9)]', '0=}', 'ß?\\'],
      ['qQ@', 'w', 'eE€', ...letters('rtzuiop'), 'üÜ', '+*~'],
      [...letters('asdfghjkl'), 'öÖ', 'äÄ', "#'"],
      ['<>|', ...letters('yxcvbnm'), ',;', '.:', '-_'],
    ],
  },
  'ch-qwertz': {
    name: 'QWERTZ (Swiss)',
    rows: [
      ['1+', '2"@', '3*#', '4ç', '5%', '6&', '7/|', '8(', '9)', '0=', "'?"],
      ['q', 'w', 'eE€', ...letters('rtzuiop'), 'üè[', '¨!]'],
      [...letters('asdfghjkl'), 'öé', 'äà{', '$£}'],
      ['<>\\', ...letters('yxcvbnm'), ',;', '.:', '-_'],
    ],
  },
  'us-qwerty': {
    name: 'QWERTY (US)',
    rows: [
      ['1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '-_'],
      [...letters('qwertyuiop'), '[{', ']}'],
      [...letters('asdfghjkl'), ';:', '\'"', '\\|'],
      ['=+`', ...letters('zxcvbnm'), ',<', '.>', '/?~'],
    ],
  },
  'uk-qwerty': {
    name: 'QWERTY (UK)',
    rows: [
      ['1!', '2"', '3£', '4$€', '5%', '6^', '7&', '8*', '9(', '0)', '-_'],
      [...letters('qwertyuiop'), '[{', ']}'],
      [...letters('asdfghjkl'), ';:', "'@", '#~'],
      ['\\|', ...letters('zxcvbnm'), ',<', '.>', '/?='],
    ],
  },
  'fr-azerty': {
    name: 'AZERTY (French)',
    rows: [
      ['&1', 'é2~', '"3#', "'4{", '(5[', '-6|', 'è7`', '_8\\', 'ç9^', 'à0@', ')°]'],
      ['a', 'z', 'eE€', ...letters('rtyuiop'), '^¨', '$£¤'],
      [...letters('qsdfghjklm'), 'ù%', '*µ'],
      ['<>', ...letters('wxcvbn'), ',?', ';.', ':/', '!§'],
    ],
  },
  'es-qwerty': {
    name: 'QWERTY (Spanish)',
    rows: [
      ['1!|', '2"@', '3·#', '4$~', '5%', '6&¬', '7/', '8(', '9)', '0=', "'?"],
      ['q', 'w', 'eE€', ...letters('rtyuiop'), '`^[', '+*]'],
      [...letters('asdfghjkl'), 'ñÑ', '´¨{', 'çÇ}'],
      ['<>', ...letters('zxcvbnm'), ',;', '.:', '-_'],
    ],
  },
  dvorak: {
    name: 'Dvorak',
    rows: [
      ['1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '[{'],
      ['\'"', ',<', '.>', ...letters('pyfgcrl'), '/?', '=+'],
      [...letters('aoeuidhtns'), '-_', '\\|'],
      [';:', ...letters('qjkxbmwvz'), ']}'],
    ],
  },
  emoji: {
    name: 'Emoji',
    follow: 'position',
    rows: [
      ['😀😁', '😂🤣', '😊😇', '😍🥰', '😎🤓', '🤔🧐', '😴🥱', '😮😱', '😢😭', '😡🤬', '🤖👾'],
      ['👍👎', '👏🙌', '👋🤝', '🙏💪', '💖💔', '💯💥', '🔥💧', '✨⭐', '🎉🎈', '🎁🎂', '🌈🌙', '🌞🌍'],
      ['🐶🐱', '🐭🐹', '🐰🦊', '🐻🐼', '🐨🐯', '🦁🐮', '🐷🐸', '🐵🐔', '🐧🐦', '🐤🦉', '🐝🐞', '🦋🐌'],
      ['🍎🍐', '🍕🍔', '🍟🌮', '🍩🍪', '🍦🍰', '☕🍵', '🍺🍷', '🚀🛸', '🚗🚲', '📚📝', '💡🔑'],
    ],
  },
} satisfies Record<string, Layout>;

export type LayoutName = keyof typeof LAYOUTS;

/** The computer's keys (KeyboardEvent.code) by the machine's position they stand for, for
 * layouts that follow positions. Backquote stands in for the ISO key a US board lacks. */
export const CODES: Record<string, string> = {};
[
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Backslash'],
  ['IntlBackslash', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
].forEach((row, r) => row.forEach((code, k) => (CODES[code] = POSITIONS[r][k])));
CODES.Backquote = POSITIONS[3][0];

/** What a layout types for a key press (by its code), or null when it doesn't follow
 * positions or the key isn't one of its. */
export function typedAt(layout: Layout, code: string, shift: boolean, alt: boolean): string | null {
  if (layout.follow !== 'position') return null;
  const id = CODES[code];
  if (!id) return null;
  const [r, k] = id.slice(1).split('k').map(Number);
  const chars = keyChars(layout.rows[r][k] ?? '');
  return chars[alt ? 2 : shift ? 1 : 0] ?? chars[0] ?? null;
}
