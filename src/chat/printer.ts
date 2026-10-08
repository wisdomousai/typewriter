import { split } from '../typewriter/layouts';
import type { Spot, Typewriter } from '../typewriter/typewriter';
import type { Turn } from './protocol';

/**
 * The chat on the typewriter's endless paper. Each turn starts on a fresh line, a blank
 * line after the last, with its typist's name in capitals; what they type follows, in their
 * ink, a character to a cell, on to the next line at the margin. Every machine in the room
 * gets the same characters in the same order, so every machine lays them out the same.
 *
 * What is typed live is struck by the machine, one character at a time; what was typed
 * before you came in is put on the paper at once.
 */
export class Printer {
  /** Where the next character goes. */
  private at: Spot = { line: 0, col: 0 };
  /** The turn being typed: whose, and the spots of its characters (a line break's too),
   * so a character taken back can be taped over. */
  private turn: { key: string; ink: string; spots: { at: Spot; ch: string }[]; text: string } | null = null;
  /** Turns already on the paper (a reconnection hears them again). */
  private printed = new Set<string>();
  private any = false;

  constructor(
    private tw: Typewriter,
    private columns: number,
  ) {}

  /** Where the typing is (for the caret). */
  get spot(): Spot {
    return { ...this.at };
  }

  /** A turn, by whom and when it began. */
  static key(t: Turn) {
    return `${t.id}:${t.at}`;
  }

  /** The turns before this machine came in, put on the paper at once. */
  history(turns: Turn[]) {
    for (const t of turns) {
      if (this.printed.has(Printer.key(t))) continue;
      this.begin(t, true);
      this.end();
    }
    this.tw.move(this.at);
  }

  /** A turn begins: a blank line, then its typist's name. `quick` puts it at once. If it
   * is the turn already being printed (heard again after a reconnection), only what this
   * machine missed of it is typed. */
  begin(t: Turn, quick = false) {
    const key = Printer.key(t);
    if (this.turn?.key === key) {
      if (t.text.startsWith(this.turn.text)) this.type(t.text.slice(this.turn.text.length), quick);
      return;
    }
    if (this.printed.has(key)) return;
    this.end();
    if (this.any) this.newline(2, quick);
    this.any = true;
    this.turn = { key, ink: t.ink, spots: [], text: '' };
    this.printed.add(key);
    for (const ch of split(`${t.name.toUpperCase()}: `)) this.put(ch, t.ink, quick);
    // The name isn't the turn's to take back.
    this.turn.spots.length = 0;
    if (t.text) this.type(t.text, quick);
  }

  /** Characters typed in the turn. */
  type(text: string, quick = false) {
    const turn = this.turn;
    if (!turn) return;
    for (const ch of split(text)) {
      turn.text += ch;
      if (ch === '\n') {
        turn.spots.push({ at: { ...this.at }, ch });
        this.newline(1, quick);
        continue;
      }
      this.put(ch, turn.ink, quick);
    }
  }

  /** The turn's last character taken back: taped over, the carriage back on its cell. */
  back() {
    const turn = this.turn;
    const last = turn?.spots.pop();
    if (!turn || !last) return;
    const parts = split(turn.text);
    turn.text = parts.slice(0, -1).join('');
    this.at = { ...last.at };
    if (last.ch === '\n' || last.ch === ' ') this.tw.move(this.at);
    else this.tw.erase(this.at);
  }

  /** The turn is over. */
  end() {
    this.turn = null;
  }

  private put(ch: string, ink: string, quick: boolean) {
    if (this.at.col >= this.columns) this.newline(1, quick);
    const at = { ...this.at };
    this.turn?.spots.push({ at, ch });
    if (!quick) this.tw.strike(ch, at, ink);
    else if (ch !== ' ') this.tw.put(at, ch, ink);
    this.at = { line: at.line, col: at.col + 1 };
  }

  /** On to a fresh line (the machine goes there now, unless it's putting text at once). */
  private newline(n = 1, quick = false) {
    this.at = { line: this.at.line + n, col: 0 };
    if (!quick) this.tw.move(this.at);
  }
}
