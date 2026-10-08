import type { Spot, Typewriter } from './typewriter';
import layout from './typewriter.json';

/**
 * A form as a letter on the typewriter's paper. The form's own fields keep the
 * text (they stay in the page, hidden while the typewriter is out, for screen readers,
 * autofill and the phone's keyboard); this lays each one out on the sheet under its label,
 * a character to a cell, and turns every change into work for the machine: new characters
 * struck, removed ones taped over, a word that runs into the margin taken over to the next
 * line. What only moved (a wrapped word, or the rest of the text pushed along by an edit in
 * the middle) is taped and restruck when it's a letter or two, and otherwise put right at
 * once, as no typist could, in its turn in the machine's queue.
 */

export const COLUMNS = layout.type.columns;

export interface Field {
  el: HTMLInputElement | HTMLTextAreaElement;
  /** Typed above it. */
  label: string;
  /** The label's line; the text starts on the next. */
  top: number;
  /** How many lines the text may take. */
  lines: number;
}

const key = (s: Spot) => `${s.line}:${s.col}`;
const unkey = (k: string): Spot => {
  const [line, col] = k.split(':').map(Number);
  return { line, col };
};
const before = (a: Spot, b: Spot) => a.line < b.line || (a.line === b.line && a.col < b.col);

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Where each character a reader would count as one (a letter with its accents, a whole
 * emoji, flags and families too) starts in a text: inside[i] is true for every code unit
 * that carries on the one before it. */
function inside(text: string): boolean[] {
  const out = new Array<boolean>(text.length).fill(true);
  for (const g of segmenter.segment(text)) out[g.index] = false;
  return out;
}

/** Where each character of a text goes when it starts on line `first`, and where the next
 * would: text[i] at cells[i] (a line break has one too, where it was typed; the rest of a
 * character made of several code units shares its first one's), the caret after them all at
 * cells[text.length]. Words wrap as a typist wraps them: one that won't fit goes over to the
 * next line whole, and only a word longer than a line is broken. A space that reaches the
 * margin takes a cell past it and ends the line. Only the word being typed ever moves as
 * text is added, so what's on the paper stays put. */
export function cells(text: string, first: number): Spot[] {
  const out: Spot[] = [];
  let line = first;
  let col = 0;
  // Where the word being laid out began.
  let word = 0;
  const cont = inside(text);
  for (let i = 0; i < text.length; i++) {
    if (cont[i]) {
      out.push(out[i - 1]);
      continue;
    }
    const ch = text[i];
    if (ch === '\n' || ch === ' ') {
      out.push({ line, col });
      if (ch === '\n' || col === COLUMNS) {
        line++;
        col = 0;
      } else col++;
      word = i + 1;
      continue;
    }
    if (col === COLUMNS) {
      line++;
      col = 0;
      // Carry the word over, unless it began the line.
      if (word < i && out[word].col > 0) {
        for (let k = word; k < i; k++) {
          if (cont[k]) out[k] = out[k - 1];
          else out[k] = { line, col: col++ };
        }
      } else word = i;
    }
    out.push({ line, col: col++ });
  }
  if (col === COLUMNS) {
    line++;
    col = 0;
  }
  out.push({ line, col });
  return out;
}

/** What is inked for text[i] at its cell: nothing for a space, a line break, or the rest of
 * a character that began before it. */
function ink(text: string, i: number, cont: boolean[]) {
  const ch = text[i];
  if (ch === '\n' || ch === ' ' || cont[i]) return '';
  let j = i + 1;
  while (j < text.length && cont[j]) j++;
  return text.slice(i, j);
}

/** Does this text fit the field's lines on the sheet? */
export function fits(f: Field, text: string) {
  return !text || cells(text, f.top + 1)[text.length - 1].line < f.top + 1 + f.lines;
}

export class Letter {
  /** What the sheet shows, or will once the machine has caught up, by cell. */
  private shown = new Map<string, string>();
  private values = new Map<Field, string>();
  /** Lines ruled for each field so far (a message gets more rules as it grows). */
  private ruled = new Map<Field, number>();

  constructor(
    private tw: Typewriter,
    readonly fields: Field[],
  ) {}

  private first(f: Field) {
    return f.top + 1;
  }

  /** A fresh sheet: rule the fields and type their labels, then whatever is already in them
   * (the browser keeps a form's text over a reload). */
  start() {
    this.shown.clear();
    this.ruled.clear();
    for (const f of this.fields) {
      this.values.set(f, '');
      this.rule(f, 0);
      [...f.label].forEach((ch, col) => this.strike(ch, { line: f.top, col }));
    }
    for (const f of this.fields) this.change(f);
  }

  /** Dotted rules to type on: the first line of a short field, the first few of a long one,
   * and always the line the text has reached. */
  private rule(f: Field, used: number) {
    const want = Math.min(f.lines, Math.max(f.lines <= 2 ? 1 : 4, used));
    const had = this.ruled.get(f) ?? 0;
    for (let n = had; n < want; n++) this.tw.paper.blank(this.first(f) + n, 0, COLUMNS);
    if (want > had) this.ruled.set(f, want);
  }

  /** The field's text changed: strike what's new, tape over what went, and move the rest. */
  change(f: Field) {
    const was = this.values.get(f) ?? '';
    const now = f.el.value;
    if (now === was) return;
    this.values.set(f, now);
    const at = cells(now, this.first(f));
    const cont = inside(now);

    // The typed stretch: what differs between the common start and the common end.
    let p = 0;
    while (p < was.length && p < now.length && was[p] === now[p]) p++;
    let s = 0;
    while (s < was.length - p && s < now.length - p && was[was.length - 1 - s] === now[now.length - 1 - s]) s++;
    const typedTo = now.length - s;

    const want = new Map<string, string>();
    for (let i = 0; i < now.length; i++) {
      const g = ink(now, i, cont);
      if (g) want.set(key(at[i]), g);
    }
    const lo = this.first(f);
    const hi = lo + f.lines;
    const clears = [...this.shown]
      .filter(([k, g]) => {
        const { line } = unkey(k);
        return line >= lo && line < hi && want.get(k) !== g;
      })
      .map(([k]) => unkey(k))
      .sort((a, b) => (before(a, b) ? 1 : -1));
    const prints: { i: number; g: string; at: Spot }[] = [];
    for (let i = 0; i < now.length; i++) {
      const g = ink(now, i, cont);
      if (g && this.shown.get(key(at[i])) !== g) prints.push({ i, g, at: at[i] });
    }
    // Small corrections are worked by the machine; a big shift is put right at once.
    const moved = clears.length + prints.filter((q) => q.i < p || q.i >= typedTo).length;
    const animate = moved <= 6;

    for (const c of clears) {
      if (animate) this.tw.erase(c);
      else this.tw.put(c, null);
      this.shown.delete(key(c));
    }
    for (let i = p; i < typedTo; i++) {
      if (now[i] === '\n' || at[i].col >= COLUMNS) this.tw.move(at[i + 1]);
      else if (now[i] === ' ') this.tw.strike(' ', at[i]);
      const q = prints.find((r) => r.i === i);
      if (q) this.strike(q.g, q.at);
    }
    for (const q of prints) {
      if (q.i >= p && q.i < typedTo) continue;
      if (animate) this.strike(q.g, q.at);
      else {
        this.tw.put(q.at, q.g);
        this.shown.set(key(q.at), q.g);
      }
    }
    this.rule(f, at[now.length].line - lo + 1);
  }

  private strike(ch: string, at: Spot) {
    this.tw.strike(ch, at);
    this.shown.set(key(at), ch);
  }

  /** Nobody is typing: roll the sheet on to where the letter stands, so everything on it
   * (every label, on a fresh sheet) is up above the platen to read. */
  park() {
    const f = this.fields[this.fields.length - 1];
    const text = f.el.value;
    this.tw.move(cells(text, this.first(f))[text.length]);
  }

  /** The caret's cell in a field. */
  caretOf(f: Field) {
    const text = f.el.value;
    const i = Math.min(f.el.selectionStart ?? text.length, text.length);
    return cells(text, this.first(f))[i];
  }

  /** The field a cell belongs to: the one whose label is on its line or the nearest above
   * (none above the first label). */
  fieldAt(at: Spot): Field | null {
    let best: Field | null = null;
    for (const f of this.fields) if (at.line >= f.top) best = f;
    return best;
  }

  /** The caret index in a field for a cell: before the first character at or after it, or
   * at the line break ending its line; the end for the label or past the text. */
  indexAt(f: Field, at: Spot) {
    const text = f.el.value;
    if (at.line <= f.top) return text.length;
    const c = cells(text, this.first(f));
    for (let i = 0; i < text.length; i++) {
      if (!before(c[i], at) || (text[i] === '\n' && c[i].line === at.line)) return i;
    }
    return text.length;
  }
}
