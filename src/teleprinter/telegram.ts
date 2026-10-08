import { split } from '../typewriter/layouts';
import type { Spot, Teleprinter } from './teleprinter';

/**
 * Telegrams on the teleprinter's roll: each one called in on the dial and announced with two
 * bells, then a header in faint ink (the time, and who it's from), the message in capitals,
 * broken at spaces to fit the line, and a blank line after it. One at a time, in order: a
 * telegram sent while another prints waits its turn.
 */
export interface Telegram {
  text: string;
  /** Who it's from, in the header. */
  from?: string;
  /** Its ink (the machine's own if not given). */
  ink?: string;
  /** When it was sent (now if not given). */
  at?: Date;
}

/** The header's ink. */
const FAINT = '#8d8a80';

export class Wire {
  private spot: Spot = { line: 0, col: 0 };
  private queue = Promise.resolve();

  constructor(private tp: Teleprinter) {}

  /** Prints a telegram after any before it; resolves when it's on the paper. */
  send(t: Telegram): Promise<void> {
    const run = this.queue.then(() => this.print(t));
    this.queue = run.catch(() => {});
    return run;
  }

  private print(t: Telegram) {
    const tp = this.tp;
    const at = t.at ?? new Date();
    const time = `${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}`;
    tp.dial(time);
    tp.ding(2);
    const from = t.from?.trim();
    this.line(from ? `${time} ${from.toUpperCase()}` : time, FAINT);
    for (const row of wrap(t.text.toUpperCase(), tp.columns)) this.line(row, t.ink);
    this.feed(1);
    return tp.done();
  }

  /** A row at the margin, then a return and a line feed. */
  private line(row: string, ink?: string) {
    let col = 0;
    for (const ch of split(row)) this.tp.strike(ch, { line: this.spot.line, col: col++ }, ink);
    this.feed(0);
  }

  /** The head back to the margin and the paper up a line, and `blank` more. */
  private feed(blank: number) {
    this.spot = { line: this.spot.line + 1 + blank, col: 0 };
    this.tp.move(this.spot);
  }
}

/** A message broken into rows of at most `columns` characters: at spaces where it can be,
 * mid-word only for a word longer than a row; its own line breaks kept. */
export function wrap(text: string, columns: number): string[] {
  const rows: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    let row: string[] = [];
    for (const word of para.split(/[ \t]+/).filter(Boolean)) {
      let w = split(word);
      if (row.length && row.length + 1 + w.length > columns) {
        rows.push(row.join(''));
        row = [];
      }
      if (row.length) row.push(' ');
      while (row.length + w.length > columns) {
        const room = columns - row.length;
        rows.push([...row, ...w.slice(0, room)].join(''));
        row = [];
        w = w.slice(room);
      }
      row.push(...w);
    }
    rows.push(row.join(''));
  }
  return rows;
}
