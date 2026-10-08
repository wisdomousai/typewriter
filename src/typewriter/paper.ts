import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { split } from './layouts';

/**
 * The typewriter's sheet as a picture: a long roll of off-white paper on a canvas, with a
 * grid of character cells in the middle and a margin of blank paper round them, a torn
 * edge at the top and the bottom. Type is drawn the way a ribbon leaves it: every strike
 * a little off its cell, a little lighter or darker, the odd one faint, and two strikes
 * in one spot printing over each other. An emoji is a rubber stamp in a cell: in its own
 * colours, or (with `stamps` 'ink') in the ribbon's ink. Only the cells that changed are
 * drawn again.
 */
export interface Spot {
  line: number;
  col: number;
}

export interface PaperOptions {
  /** Characters per line, and lines the sheet can hold. */
  columns: number;
  lines?: number;
  /** The sheet's width in cells (the margin is what is left of the columns), and the
   * blank lines above the first and below the last. */
  sheetColumns: number;
  topLines?: number;
  bottomLines?: number;
  /** Emoji in their own colours, or stamped in the ribbon's ink. */
  stamps?: 'colour' | 'ink';
}

const PICTURE = /\p{Extended_Pictographic}/u;

/** Cell size in canvas px: a character's width, and the line height from the type grid. */
const CELL_W = 24;
const PAPER = '#f7f7f4';
const INK = '#151514';
const DOTS = '#8d8d86';
/** Where the baseline sits in a cell (fraction of its height), and the font's advance. */
const BASE = 0.66;
const ADVANCE = 0.6;

interface Strike {
  ch: string;
  dx: number;
  dy: number;
  rot: number;
  alpha: number;
}

export class Paper {
  readonly texture: CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  readonly columns: number;
  readonly lines: number;
  readonly sheetColumns: number;
  readonly topLines: number;
  readonly bottomLines: number;
  /** Blank columns to the left of column 0. */
  readonly margin: number;
  /** Cell size (px) and the canvas size (px). */
  readonly cw = CELL_W;
  readonly ch: number;
  /** Font and type are ready: until then nothing is drawn, so no fallback flashes. */
  readonly ready: Promise<void>;
  private ctx: CanvasRenderingContext2D;
  private strikes: Strike[][];
  private ghosts: Strike[][];
  private rules: Uint8Array;
  private dirty = new Set<number>();
  private font: string;
  private loaded = false;
  private seed = 1;
  private at: Spot | null = null;
  private caretOn = true;
  private caretTime = 0;
  private whole = true;
  private stampsIn: 'colour' | 'ink';
  /** A cell-sized canvas to ink a stamp on before it goes on the sheet. */
  private pad: HTMLCanvasElement | null = null;

  /** `lineRatio` is the type grid's line height over its pitch, so the cells are as tall
   * as the paper's lines are. */
  constructor(opts: PaperOptions, lineRatio = 1.9) {
    this.columns = opts.columns;
    this.lines = opts.lines ?? 40;
    this.sheetColumns = opts.sheetColumns;
    this.topLines = opts.topLines ?? 3;
    this.bottomLines = opts.bottomLines ?? 3;
    this.stampsIn = opts.stamps ?? 'colour';
    this.margin = Math.floor((this.sheetColumns - this.columns) / 2);
    this.ch = Math.round(CELL_W * lineRatio);
    const canvas = (this.canvas = document.createElement('canvas'));
    canvas.width = this.sheetColumns * this.cw;
    canvas.height = (this.topLines + this.lines + this.bottomLines) * this.ch;
    this.ctx = canvas.getContext('2d')!;
    const n = this.lines * this.columns;
    this.strikes = Array.from({ length: n }, () => []);
    this.ghosts = Array.from({ length: n }, () => []);
    this.rules = new Uint8Array(n);
    this.font = `${Math.round(this.cw / ADVANCE)}px "Maple Mono", ui-monospace, monospace`;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.flipY = false; // the canvas' top is the sheet's top edge
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.anisotropy = 8;
    this.blankSheet();
    this.ready = this.loadFont();
  }

  private async loadFont() {
    try {
      await document.fonts.load(this.font.replace(/^(\d+px)/, '400 $1'), 'abcXYZ0189@€§ßü');
    } catch {
      // The fallback mono will do.
    }
    this.loaded = true;
    this.whole = true;
  }

  /** Emoji in their own colours or in ink, from now on (what is on the sheet changes too). */
  get stamps() {
    return this.stampsIn;
  }
  set stamps(v: 'colour' | 'ink') {
    if (v === this.stampsIn) return;
    this.stampsIn = v;
    this.whole = true;
  }

  /** Characters the sheet holds. */
  get capacity() {
    return this.lines * this.columns;
  }

  private has(at: Spot) {
    return at.line >= 0 && at.line < this.lines && at.col >= 0 && at.col < this.columns;
  }

  private index(at: Spot) {
    return at.line * this.columns + at.col;
  }

  private rand() {
    // mulberry32: the same sheet types the same way every time.
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A character lands on the paper (a space leaves nothing). */
  print(ch: string, at: Spot) {
    if (!this.has(at) || ch === ' ' || ch === '') return;
    const i = this.index(at);
    const r = () => this.rand() - 0.5;
    const faint = this.rand() < 0.08;
    const list = this.strikes[i];
    if (list.length >= 4) list.shift();
    list.push({
      ch,
      dx: r() * 1.6,
      dy: r() * 1.8,
      rot: r() * 0.05,
      alpha: faint ? 0.42 + this.rand() * 0.15 : 0.8 + this.rand() * 0.2,
    });
    this.dirty.add(i);
  }

  /** Whites a spot out, leaving a ghost of what was there (or, with `ghost` false, nothing:
   * for text the page moves rather than corrects). */
  clear(at: Spot, ghost = true) {
    if (!this.has(at)) return;
    const i = this.index(at);
    if (!ghost) this.ghosts[i] = [];
    else if (this.strikes[i].length) this.ghosts[i] = this.strikes[i].slice(-2);
    this.strikes[i] = [];
    this.dirty.add(i);
  }

  /** Types a string at once, with no animation. */
  text(at: Spot, str: string) {
    let col = at.col;
    for (const ch of split(str)) this.print(ch, { line: at.line, col: col++ });
  }

  /** A dotted rule to type on, from col0 to col1 (both included). */
  blank(line: number, col0: number, col1: number) {
    for (let col = col0; col <= col1; col++) {
      const at = { line, col };
      if (!this.has(at)) continue;
      this.rules[this.index(at)] = 1;
      this.dirty.add(this.index(at));
    }
  }

  /** A fresh sheet. */
  clearAll() {
    this.strikes.forEach((s, i) => {
      s.length = 0;
      this.ghosts[i] = [];
    });
    this.rules.fill(0);
    this.dirty.clear();
    this.blankSheet();
    this.whole = true;
  }

  /** A small blinking caret under a spot, or none. */
  caret(at: Spot | null) {
    if (this.at && this.has(this.at)) this.dirty.add(this.index(this.at));
    // A spot one past the last column (a space at the margin) is the end of its line.
    const c = at ? { line: at.line, col: Math.min(at.col, this.columns - 1) } : null;
    this.at = c && this.has(c) ? c : null;
    this.caretOn = true;
    this.caretTime = 0;
    if (this.at) this.dirty.add(this.index(this.at));
  }

  /** The blink, and whatever changed drawn again. Call every frame. */
  update(dt: number) {
    if (this.at) {
      this.caretTime += dt;
      const on = this.caretTime % 1.1 < 0.65;
      if (on !== this.caretOn) {
        this.caretOn = on;
        this.dirty.add(this.index(this.at));
      }
    }
    this.flush();
  }

  /** Draws what changed. */
  flush() {
    if (!this.loaded) return;
    if (this.whole) {
      this.whole = false;
      this.dirty.clear();
      this.blankSheet();
      for (let i = 0; i < this.strikes.length; i++)
        if (this.strikes[i].length || this.ghosts[i].length || this.rules[i]) this.drawCell(i);
      if (this.at) this.drawCell(this.index(this.at));
      this.texture.needsUpdate = true;
      return;
    }
    if (!this.dirty.size) return;
    for (const i of this.dirty) this.drawCell(i);
    this.dirty.clear();
    this.texture.needsUpdate = true;
  }

  /** A copy of the sheet as it is, for one that is torn off and flies away. */
  snapshot(): CanvasTexture {
    this.flush();
    const copy = document.createElement('canvas');
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    copy.getContext('2d')!.drawImage(this.canvas, 0, 0);
    const texture = new CanvasTexture(copy);
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 8;
    return texture;
  }

  /** The bare sheet: paper all over, torn at the top and the bottom. */
  private blankSheet() {
    const c = this.ctx;
    const { width: W, height: H } = this.canvas;
    c.clearRect(0, 0, W, H);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    // A torn edge: short uneven bites of transparent paper along it.
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let x = 0; x < W;) {
      const step = 2 + Math.floor(r() * 4);
      const bite = 1 + r() * r() * 9;
      c.clearRect(x, 0, step, bite);
      c.clearRect(x, H - bite, step, bite);
      x += step;
    }
  }

  private drawCell(i: number) {
    const c = this.ctx;
    const { cw, ch } = this;
    const col = i % this.columns;
    const line = (i - col) / this.columns;
    const x = (this.margin + col) * cw;
    const y = (this.topLines + line) * ch;
    c.save();
    c.beginPath();
    c.rect(x, y, cw, ch);
    c.clip();
    c.fillStyle = PAPER;
    c.fillRect(x, y, cw, ch);
    if (this.rules[i]) {
      c.fillStyle = DOTS;
      const base = y + ch * BASE + 3;
      const k = cw / 28;
      for (let d = 0; d < 4; d++) {
        c.beginPath();
        c.arc(x + (3.5 + d * 7) * k, base, 1.05 * k + 0.1, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.font = this.font;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    const ghost = this.ghosts[i];
    if (ghost.length) {
      this.glyphs(ghost, x, y, 0.1);
      // The correction tape's chalky block over what was there.
      c.fillStyle = 'rgba(250,250,247,0.78)';
      c.fillRect(x + 1.5, y + ch * 0.2, cw - 3, ch * 0.62);
    }
    this.glyphs(this.strikes[i], x, y, 1);
    if (this.at && this.caretOn && this.index(this.at) === i) {
      c.fillStyle = INK;
      const b = y + ch * BASE + 9;
      c.fillRect(x + 3, b, cw - 6, 2.4);
      c.fillRect(x + 3, b - 5, 2.4, 7.4);
      c.fillRect(x + cw - 5.4, b - 5, 2.4, 7.4);
    }
    c.restore();
  }

  private glyphs(list: Strike[], x: number, y: number, fade: number) {
    const c = this.ctx;
    c.fillStyle = c.strokeStyle = INK;
    c.lineWidth = 0.7;
    c.lineJoin = 'round';
    for (const s of list) {
      if (PICTURE.test(s.ch)) {
        this.stamp(s, x, y, fade);
        continue;
      }
      c.save();
      c.translate(x + this.cw / 2 + s.dx, y + this.ch * BASE + s.dy);
      c.rotate(s.rot);
      c.globalAlpha = s.alpha * fade;
      c.fillText(s.ch, 0, 0);
      // A little ink bleed round the stroke.
      c.globalAlpha = s.alpha * fade * 0.5;
      c.strokeText(s.ch, 0, 0);
      c.restore();
    }
  }

  /** An emoji, shrunk to its cell's width and sat on the line like a capital. In ink it is
   * the emoji's shape filled with the ribbon's ink. */
  private stamp(s: Strike, x: number, y: number, fade: number) {
    const c = this.ctx;
    const size = this.cw;
    c.save();
    c.translate(x + this.cw / 2 + s.dx, y + this.ch * BASE - size * 0.42 + s.dy);
    c.rotate(s.rot);
    c.globalAlpha = Math.min(1, s.alpha + 0.12) * fade;
    if (this.stampsIn === 'ink') {
      const pad = (this.pad ??= document.createElement('canvas'));
      pad.width = pad.height = Math.ceil(size * 2);
      const p = pad.getContext('2d')!;
      emoji(p, s.ch, pad.width / 2, pad.height / 2, pad.width);
      p.globalCompositeOperation = 'source-in';
      p.fillStyle = INK;
      p.fillRect(0, 0, pad.width, pad.height);
      c.drawImage(pad, -size / 2, -size / 2, size, size);
    } else emoji(c, s.ch, 0, 0, size);
    c.restore();
  }

  dispose() {
    this.texture.dispose();
  }
}

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** An emoji centred on (x, y), no wider or taller than `size` px. */
function emoji(c: CanvasRenderingContext2D, e: string, x: number, y: number, size: number) {
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `${size}px ${EMOJI_FONT}`;
  const k = Math.min(1, size / Math.max(1, c.measureText(e).width));
  c.font = `${Math.floor(size * k)}px ${EMOJI_FONT}`;
  c.fillText(e, x, y);
}
