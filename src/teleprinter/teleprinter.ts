import {
  BackSide,
  type BufferAttribute,
  BufferGeometry,
  Box3,
  type Camera,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Sphere,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { Face, TYPEWRITER_FACE } from '../typewriter/face';
import { dress, glowColour, type LookName, type Outfit } from '../typewriter/looks';
import { loadModel } from '../typewriter/model';
import { Paper, type Spot } from '../typewriter/paper';
import { clampStep, Hinge, Slider } from '../typewriter/rig';
import { type PathGeometry, Route } from '../typewriter/route';
import type { SoundEvent, SoundName } from '../typewriter/sound';
import { Spring, wobble } from '../typewriter/spring';
import { type Machine, mountStage, type StageOptions } from '../typewriter/stage';
import SPEC from './teleprinter.json';

export type { Spot } from '../typewriter/paper';

/**
 * The robot teleprinter (blender/teleprinter.py): a machine that prints what comes down the
 * line on endless paper, a character at a time at its own steady pace. Its print head runs
 * along a rail in front of the platen: for each character the typewheel spins round to it,
 * the rocker pecks the wheel at the paper, the character lands and the head steps on. At the
 * end of a line the head runs back to the margin while the platen feeds the paper up, and
 * the paper rises out through the tear bar and curls back over the machine.
 *
 * Like the typewriter, everything is posed live from springs, in fixed steps. The paper is a
 * strip laid along its path whose picture slides through it as the platen turns.
 */
export type Mood = 'idle' | 'happy' | 'puzzled' | 'asleep';

export interface TeleprinterOptions {
  /** Where teleprinter.glb is served from. */
  models: string;
  look?: LookName;
  /** The colour look's palette (palettes.json). */
  palette?: string;
  reducedMotion?: boolean;
}

interface Geometry extends PathGeometry {
  paperX: number[];
  textX0: number;
  peckBack: number;
  bellSwing: number;
  dialStep: number;
}

const TYPE = SPEC.type;
const GEO = SPEC.geometry as Geometry;
/** The lines the paper keeps (its picture repeats every this many). */
const RING = 88;
const SHEET_COLUMNS = Math.round(TYPE.paperWidth / TYPE.pitch);
const MARGIN = (SHEET_COLUMNS - TYPE.columns) / 2;
/** Lines of free paper above the print point before it curls back over the machine, and the
 * curl's bend and run (see route.ts). */
const CURL_LINES = 13;
const CURL_BEND = 3.4;
const CURL_RUN = 1.1;
/** Lines above the print point the wide camera keeps in frame. */
const FRAME_LINES = 14;
/** Characters a second, as a teleprinter's motor sets them; the head's run back to the
 * margin (columns/s², columns/s); how fast it steps on (columns/s). */
const CPS = 12;
const RUN_ACCEL = 900;
const RUN_MAX = 150;
const ESCAPE = 300;
/** The typewheel's slots: a character spins it to its own. */
const SLOTS = 48;
/** How long the wheel spins and the rocker pecks before the character lands (s). */
const PECK = 0.035;
const STEP = 1 / 120;
const BELL_COLUMN = TYPE.columns - 4;
const PAPER_TINT = '#e6e6e2';
const HALF_WIDTH = 0.66;
const INK = '#151514';

type Job =
  | { kind: 'strike'; ch: string; at: Spot; ink?: string }
  | { kind: 'move'; at: Spot }
  | { kind: 'ding'; times: number }
  | { kind: 'dial'; digits: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'call'; done: () => void };

export class Teleprinter implements Machine {
  readonly group = new Group();
  readonly ready: Promise<void>;
  readonly paper: Paper;
  readonly bounds = new Box3();
  readonly printPoint = new Vector3();
  reducedMotion: boolean;
  camera: Camera | null = null;
  onSound: ((e: SoundEvent) => void) | null = null;
  private look_: LookName;
  private palette: string;
  private outfit: Outfit | null = null;
  private model: Object3D | null = null;
  private face = new Face('#f4f4f1', TYPEWRITER_FACE);
  private route: Route;
  private x0 = GEO.paperX[0];
  private rows: number;
  private ribbonMat: MeshStandardMaterial | null = null;
  private rollMat: MeshStandardMaterial | null = null;
  private ink: string | null = null;

  // Bones.
  private head: Slider | null = null;
  private peck: Hinge | null = null;
  private wheel: Hinge | null = null;
  private platen: Hinge | null = null;
  private roll: Hinge | null = null;
  private dialH: Hinge | null = null;
  private bell: Hinge | null = null;
  private antenna: Hinge | null = null;
  private body: Slider | null = null;

  // Springs.
  private headS = new Spring(14, 0.45, 0.5);
  private headCalm = new Spring(14, 1, 0);
  private feed = new Spring(10, 0.65, 0.2);
  private feedCalm = new Spring(12, 1, 0);
  private wheelS = new Spring(22, 0.75, 0);
  private peckS = new Spring(24, 0.6, 0, GEO.peckBack);
  private antS = new Spring(3, 0.12);
  private bobS = new Spring(5, 0.35);
  private dialS = new Spring(9, 0.9, 0);
  private gazeX = new Spring(3.5, 0.8, 0);
  private gazeY = new Spring(3.5, 0.8, 0);

  // The strip of paper.
  private sheet = new Group();
  private geometry: BufferGeometry | null = null;
  private frontMat: MeshStandardMaterial;
  private backMat: MeshStandardMaterial;
  private fed = NaN;

  // The queue and where the machine is going.
  private jobs: Job[] = [];
  private head_ = 0;
  private clock = 0;
  private next = 0;
  private tempo = 1;
  private tCol = 0;
  private rCol = 0;
  private vCol = 0;
  private running = false;
  private tLine = 0;
  private rLine = 0;
  private feedRate = 30;
  private wheelAngle = 0;
  private pending: { t: number; ch: string; at: Spot; ink?: string } | null = null;
  private dialing: { digits: number[]; t: number; out: boolean } | null = null;
  private dialTurn = 0;
  private bellT = -1;
  private bells = 0;
  private lastStrike = -10;
  private acc = 0;
  private moodNow: Mood = 'idle';
  private pointer: { x: number; y: number } | null = null;
  private faceAt = new Vector3();
  private tmp = new Vector3();
  private sample = { u: 0, v: 0, tu: 0, tv: 0 };
  /** The line is open (a lamp says so). */
  online = false;

  constructor(opts: TeleprinterOptions) {
    this.reducedMotion = !!opts.reducedMotion;
    this.look_ = opts.look ?? 'ink';
    this.palette = opts.palette ?? 'teleprinter';
    this.route = new Route(GEO, { line: TYPE.line, curlLines: CURL_LINES, curlBend: CURL_BEND, curlRun: CURL_RUN });
    this.rows = Math.ceil(this.route.length / 0.0065);
    this.paper = new Paper(
      { columns: TYPE.columns, lines: 64, sheetColumns: SHEET_COLUMNS, topLines: 0, bottomLines: 0, ring: RING },
      TYPE.line / TYPE.pitch,
    );
    this.frontMat = new MeshStandardMaterial({ map: this.paper.texture, color: PAPER_TINT, roughness: 0.95, alphaTest: 0.85 });
    this.backMat = new MeshStandardMaterial({ color: '#dcdcd8', roughness: 0.95, side: BackSide });
    this.ready = Promise.all([loadModel(`${opts.models}teleprinter.glb`).then((m) => this.mount(m)), this.paper.ready]).then(
      () => undefined,
    );
  }

  /** Is there anything still to print? */
  get busy() {
    return this.head_ < this.jobs.length || !!this.pending || !!this.dialing || this.running;
  }

  get lineSpan() {
    return { x: this.x0 + (MARGIN + TYPE.columns / 2) * TYPE.pitch, width: (TYPE.columns + 2) * TYPE.pitch * 1.04 };
  }

  get pitch() {
    return TYPE.pitch;
  }

  /** The paper stays put; the head runs. */
  get shift() {
    return 0;
  }

  get columns() {
    return TYPE.columns;
  }

  private mount(model: Object3D) {
    this.model = model;
    this.group.add(model);
    this.group.updateMatrixWorld(true);
    const X = new Vector3(1, 0, 0);
    const find = (name: string) => model.getObjectByName(name) ?? null;
    const hinge = (name: string) => {
      const b = find(name);
      return b ? new Hinge(b, X) : null;
    };
    const head = find('head');
    this.head = head ? new Slider(head, model, X) : null;
    const body = find('body');
    this.body = body ? new Slider(body, model, new Vector3(0, 1, 0)) : null;
    this.peck = hinge('peck');
    this.wheel = hinge('wheel');
    this.platen = hinge('platen');
    this.roll = hinge('roll');
    this.dialH = hinge('dial');
    this.bell = hinge('bell');
    this.antenna = hinge('antenna');
    this.group.add(this.sheet);
    this.buildSheet();
    this.printPoint.set(0, GEO.print[2], -GEO.print[1]);
    this.bounds.setFromObject(model);
    const s = this.sample;
    this.route.at(this.route.printAt + (FRAME_LINES + 0.5) * TYPE.line, s);
    this.bounds.expandByPoint(this.tmp.set(this.x0, s.v, s.u));
    this.bounds.expandByPoint(this.tmp.set(-this.x0, s.v, s.u));
    this.dress(this.look_);
    const screen = this.meshes('Screen')[0];
    if (screen) this.faceAt.copy(new Box3().setFromObject(screen).getCenter(new Vector3()));
    this.paper.reserve(Math.ceil(this.route.printAt / TYPE.line) + 2);
    this.shape(true);
  }

  private meshes(role: string): Mesh[] {
    const found: Mesh[] = [];
    this.model?.traverse((o) => {
      if ((o as Mesh).isMesh && o.userData.role === role && !o.userData.outline) found.push(o as Mesh);
    });
    return found;
  }

  dress(look: LookName) {
    this.look_ = look;
    if (!this.model) return;
    this.outfit?.dispose();
    this.outfit = dress(this.model, look, { screen: this.face.texture, model: this.palette });
    this.face.setGlow(glowColour.value ?? '#f4f4f1');
    this.rollMat ??= new MeshStandardMaterial({ color: PAPER_TINT, roughness: 0.95 });
    for (const m of this.meshes('Glow_Paper')) m.material = this.rollMat;
    this.ribbon(this.ink);
  }

  /** The colour look's palette. */
  repaint(palette: string) {
    this.palette = palette;
    this.dress(this.look_);
  }

  /** The inking roller's colour (the ink being printed in), or the look's (null). */
  ribbon(ink: string | null) {
    this.ink = ink;
    if (!ink) return;
    this.ribbonMat ??= new MeshStandardMaterial({ roughness: 0.55 });
    this.ribbonMat.color.set(ink);
    for (const m of this.meshes('Bezel_Ribbon')) m.material = this.ribbonMat;
  }

  private buildSheet() {
    const geometry = (this.geometry = new BufferGeometry());
    const rows = this.rows;
    const n = rows * 2;
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
    const uv = geometry.getAttribute('uv') as BufferAttribute;
    for (let j = 0; j < rows; j++) {
      uv.setX(j * 2, 0);
      uv.setX(j * 2 + 1, 1);
    }
    const index: number[] = [];
    for (let j = 0; j < rows - 1; j++) {
      const a = j * 2;
      index.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    geometry.setIndex(new Uint16BufferAttribute(index, 1));
    geometry.boundingSphere = new Sphere(new Vector3(0, 0.8, 0), 4);
    for (const mat of [this.frontMat, this.backMat]) {
      const m = new Mesh(geometry, mat);
      m.frustumCulled = false;
      this.sheet.add(m);
    }
  }

  /** The strip along the whole path, its picture slid to the feed it is at. */
  private shape(force = false) {
    const geometry = this.geometry;
    const feed = this.feed.y;
    if (!geometry || (!force && Math.abs(feed - this.fed) < 1e-5)) return;
    this.fed = feed;
    const pos = geometry.getAttribute('position') as BufferAttribute;
    const nor = geometry.getAttribute('normal') as BufferAttribute;
    const uv = geometry.getAttribute('uv') as BufferAttribute;
    const r = this.route;
    const s = this.sample;
    const x0 = this.x0;
    const x1 = x0 + TYPE.paperWidth;
    for (let j = 0; j < this.rows; j++) {
      const along = r.length * (1 - j / (this.rows - 1));
      const v = (feed + 0.5 + (r.printAt - along) / TYPE.line) / RING;
      uv.setY(j * 2, v);
      uv.setY(j * 2 + 1, v);
      r.at(along, s);
      pos.setXYZ(j * 2, x0, s.v, s.u);
      pos.setXYZ(j * 2 + 1, x1, s.v, s.u);
      nor.setXYZ(j * 2, 0, -s.tu, s.tv);
      nor.setXYZ(j * 2 + 1, 0, -s.tu, s.tv);
    }
    pos.needsUpdate = nor.needsUpdate = uv.needsUpdate = true;
  }

  // ---- What the page asks for ----------------------------------------------------------

  /** Queued: a character printed at a spot, in the machine's ink or another. */
  strike(ch: string, at: Spot, ink?: string) {
    this.jobs.push({ kind: 'strike', ch, at, ink });
  }

  /** Queued: the head and the paper to a spot (a return and line feeds, say). */
  move(at: Spot) {
    this.jobs.push({ kind: 'move', at });
  }

  /** Queued: the bell, a few times. */
  ding(times = 1) {
    this.jobs.push({ kind: 'ding', times });
  }

  /** Queued: a number dialled on the front, digit by digit. */
  dial(digits: string) {
    this.jobs.push({ kind: 'dial', digits });
  }

  wait(seconds: number) {
    this.jobs.push({ kind: 'wait', seconds });
  }

  /** Resolves when everything queued before it is done. */
  done(): Promise<void> {
    return new Promise((done) => this.jobs.push({ kind: 'call', done }));
  }

  look(ndc: { x: number; y: number } | null) {
    this.pointer = ndc;
  }

  mood(m: Mood) {
    this.moodNow = m;
  }

  // ---- The queue ------------------------------------------------------------------------

  private sound(name: SoundName, gain = 1, pan = 0) {
    this.onSound?.({ name, gain, pan });
  }

  /** The head's x for a column (m, from where it rests at column 0), and where that is. */
  private xOf(col: number) {
    return col * TYPE.pitch;
  }

  private headX(col: number) {
    return this.x0 + (MARGIN + col + 0.5) * TYPE.pitch;
  }

  /** Sends the head and the paper to a spot; returns how long that takes (s). */
  private aim(col: number, line: number) {
    const dc = col - this.tCol;
    const dl = line - this.tLine;
    this.tCol = Math.min(Math.max(col, 0), TYPE.columns);
    this.tLine = Math.max(line, this.tLine);
    this.paper.reserve(this.tLine + Math.ceil(this.route.printAt / TYPE.line) + 2);
    let seconds = 0;
    if (Math.abs(dc) > 2) {
      this.running = true;
      seconds = Math.sqrt((2 * Math.abs(dc)) / RUN_ACCEL) + Math.abs(dc) / RUN_MAX + 0.04;
    } else if (dc) seconds = 0.03;
    if (dl > 0) {
      seconds = Math.max(seconds, 0.12 * Math.min(dl, 3));
      this.feedRate = dl > 4 ? 26 : 34;
      this.antS.kick(0.6);
    }
    return seconds;
  }

  private run(job: Job, late: number): number {
    switch (job.kind) {
      case 'strike': {
        const travel = this.aim(job.at.col, job.at.line);
        if (this.pending) this.land();
        // The wheel spins round to the character's slot, the short way.
        let h = 0;
        for (const c of job.ch) h = (h * 31 + c.codePointAt(0)!) >>> 0;
        const slot = ((h % SLOTS) * Math.PI * 2) / SLOTS;
        let turn = slot - (this.wheelAngle % (Math.PI * 2));
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.wheelAngle += turn;
        this.pending = { t: -travel + late, ch: job.ch, at: job.at, ink: job.ink };
        this.lastStrike = this.clock;
        return travel + 1 / CPS;
      }
      case 'move':
        return Math.max(this.aim(job.at.col, job.at.line), 0.05);
      case 'ding':
        this.bells = job.times - 1;
        this.ring();
        return 0.3 * job.times;
      case 'dial': {
        const digits = [...job.digits].filter((d) => /\d/.test(d)).map((d) => Number(d) || 10);
        if (!digits.length || this.reducedMotion) return 0;
        this.dialing = { digits, t: 0, out: true };
        return digits.reduce((s, d) => s + this.dialTime(d), 0) + 0.2;
      }
      case 'wait':
        return job.seconds;
      case 'call':
        job.done();
        return 0;
    }
  }

  /** How long a digit takes to dial: the finger wheel out to the stop and back (s). */
  private dialTime(d: number) {
    return 0.15 + d * 0.07 + (GEO.dialStep * (d + 1)) / 9 + 0.05;
  }

  /** The wheel meets the paper: the character lands and the head steps on. */
  private land() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p.ch !== ' ') {
      this.paper.print(p.ch, p.at, p.ink ?? this.ink ?? INK);
      this.peckS.kick(4);
      this.sound('clack', 0.7, -this.headX(p.at.col) / HALF_WIDTH);
      this.outfit?.dot(2, 1);
    }
    if (p.at.col === BELL_COLUMN) this.ring();
    if (this.tLine === p.at.line && this.tCol === p.at.col) {
      this.tCol = Math.min(p.at.col + 1, TYPE.columns);
      this.sound('tick', 0.3, 0.2);
    }
  }

  private ring() {
    this.bellT = 0;
    this.sound('bell', 0.55, -0.6);
  }

  // ---- Every frame ----------------------------------------------------------------------

  update(dt: number) {
    if (!this.model) return;
    this.acc = Math.min(this.acc + Math.max(0, dt), STEP * 12);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.tick(STEP);
    }
    this.shape();
    this.paper.update(dt);
    this.faceStep();
  }

  private tick(dt: number) {
    this.clock += dt;
    const now = this.clock;
    // A teleprinter keeps its own pace; a long backlog only hurries it a little.
    const backlog = this.jobs.length - this.head_;
    this.tempo = Math.min(3, Math.max(1, backlog / 40));
    this.next = Math.max(this.next, now - dt);
    let guard = 200;
    while (this.head_ < this.jobs.length && this.next <= now && guard-- > 0) {
      const job = this.jobs[this.head_++];
      this.next += this.run(job, now - this.next) / this.tempo;
    }
    if (this.head_ >= this.jobs.length && this.head_ > 0) {
      this.jobs.length = 0;
      this.head_ = 0;
    }

    // The wheel's peck.
    const p = this.pending;
    if (p) {
      p.t += dt * this.tempo;
      if (p.t >= PECK) this.land();
    }

    // The head: a step or two at the escapement's pace, further on a run that gathers speed
    // and hits the stop.
    if (this.running) {
      const dir = Math.sign(this.tCol - this.rCol);
      const from = this.rCol;
      this.vCol = Math.max(-RUN_MAX, Math.min(RUN_MAX, this.vCol + dir * RUN_ACCEL * dt));
      this.rCol += this.vCol * dt;
      if (Math.floor(from) !== Math.floor(this.rCol)) this.sound('zip', 0.22, -this.headX(this.rCol) / HALF_WIDTH);
      if (!dir || (this.tCol - this.rCol) * dir <= 0) {
        const hit = Math.min(1, Math.abs(this.vCol) / RUN_MAX);
        this.rCol = this.tCol;
        this.vCol = 0;
        this.running = false;
        if (hit > 0.1) {
          this.sound('thunk', 0.3 + 0.5 * hit, dir < 0 ? -0.6 : 0.6);
          if (!this.reducedMotion) this.bobS.kick(-0.25 * hit);
        }
      }
    } else this.rCol += clampStep(this.tCol - this.rCol, ESCAPE * dt);
    const line = this.rLine;
    this.rLine += clampStep(this.tLine - this.rLine, this.feedRate * dt);
    if (Math.floor(line + 0.5) !== Math.floor(this.rLine + 0.5)) this.sound('ratchet', 0.45, 0.4);

    const hx = this.calm(this.headS, this.headCalm, dt, this.xOf(this.rCol));
    const fd = this.calm(this.feed, this.feedCalm, dt, this.rLine);
    this.head?.set(hx);
    this.printPoint.x = this.headX(this.rCol);
    this.platen?.set((fd * TYPE.line) / GEO.platenRadius);
    this.roll?.set((fd * TYPE.line) / GEO.rollRadius);
    this.wheel?.set(this.wheelS.update(dt, this.wheelAngle));
    // The rocker rests leaned back off the paper and comes in to meet it for each character.
    this.peck?.set(this.peckS.update(dt, this.pending && this.pending.t > -0.03 ? 0 : GEO.peckBack));
    this.parts(dt);
  }

  private calm(lively: Spring, brisk: Spring, dt: number, target: number) {
    const a = lively.update(dt, target);
    const b = brisk.update(dt, target);
    return this.reducedMotion ? b : a;
  }

  /** The dial, the bell, the antenna, the lamps and the body on its feet. */
  private parts(dt: number) {
    const t = this.clock;
    const still = this.reducedMotion;
    // The dial: the finger wheel pulled round to the stop, then let go to run back, clicking
    // once for every unit of the digit.
    const d = this.dialing;
    if (d) {
      d.t += dt;
      const digit = d.digits[0];
      const out = 0.15 + digit * 0.07;
      const target = d.t < out ? GEO.dialStep * (digit + 1) * Math.min(1, d.t / out) : 0;
      if (d.out && d.t >= out) {
        d.out = false;
        this.sound('lever', 0.4, 0.6);
      }
      const before = this.dialTurn;
      this.dialTurn = d.out ? target : Math.max(0, this.dialTurn - dt * 9);
      if (!d.out && Math.floor(before / GEO.dialStep) !== Math.floor(this.dialTurn / GEO.dialStep))
        this.sound('tick', 0.35, 0.6);
      if (!d.out && this.dialTurn <= 0) {
        d.digits.shift();
        d.t = 0;
        d.out = true;
        if (!d.digits.length) this.dialing = null;
      }
    }
    this.dialH?.set(-this.dialS.update(dt, this.dialTurn));
    // The bell rattles, and rings again if it was asked for a few.
    let ring = 0;
    if (this.bellT >= 0) {
      this.bellT += dt;
      ring = Math.sin(this.bellT * 90) * Math.exp(-this.bellT * 7) * 0.5;
      if (this.bellT > 0.28 && this.bells > 0) {
        this.bells--;
        this.ring();
      } else if (this.bellT > 1.2) this.bellT = -1;
    }
    this.bell?.set(ring * GEO.bellSwing * 2);
    const sway = still ? 0 : wobble(t * 0.6, 3) * 0.02;
    this.antenna?.set(this.antS.update(dt, 0) * 0.3 + sway);
    const bob = still ? 0 : this.bobS.update(dt, 0);
    this.body?.set(bob * 0.01);
    const o = this.outfit;
    if (o) {
      const busy = t - this.lastStrike < 0.4;
      o.dot(0, 0.8);
      o.dot(1, this.online ? 0.9 : still ? 0.15 : 0.15 + 0.15 * Math.max(0, Math.sin(t * 2)));
      o.dot(2, busy ? 0.6 + 0.4 * Math.max(0, Math.sin(t * 40)) : 0.1);
      o.dot(3, this.bellT >= 0 ? 1 : 0.2);
    }
    this.face.look.x = this.gazeX.update(dt, this.gazeTarget.x);
    this.face.look.y = this.gazeY.update(dt, this.gazeTarget.y);
  }

  private gazeTarget = { x: 0, y: 0 };

  /** The face: busy while printing, and its eyes on the head (or on the pointer). */
  private faceStep() {
    const f = this.face;
    const printing = this.clock - this.lastStrike < 0.8 || this.busy;
    const m = this.moodNow;
    f.mark = m === 'puzzled' ? 'question' : 'none';
    f.expression = m === 'asleep' ? 'asleep' : m === 'happy' ? 'happy' : printing ? 'focused' : 'neutral';
    let gx = 0;
    let gy = 0;
    const cam = this.camera;
    if (cam && m !== 'asleep' && (printing || this.pointer)) {
      let tx: number;
      let ty: number;
      if (printing) {
        const p = this.group.localToWorld(this.tmp.copy(this.printPoint)).project(cam);
        [tx, ty] = [p.x, p.y];
      } else [tx, ty] = [this.pointer!.x, this.pointer!.y];
      const c = this.group.localToWorld(this.tmp.copy(this.faceAt)).project(cam);
      gx = Math.max(-1, Math.min(1, (tx - c.x) * 2.2));
      gy = Math.max(-1, Math.min(1, -(ty - c.y) * 2.2));
    }
    this.gazeTarget.x = gx;
    this.gazeTarget.y = gy;
    f.update(this.reducedMotion ? 0 : this.clock);
  }

  dispose() {
    this.group.removeFromParent();
    this.outfit?.dispose();
    this.face.dispose();
    this.paper.dispose();
    this.geometry?.dispose();
    this.frontMat.dispose();
    this.backMat.dispose();
    this.ribbonMat?.dispose();
    this.rollMat?.dispose();
  }
}

/** The machine on a canvas of its own (stage.ts). */
export function mountTeleprinter(canvas: HTMLCanvasElement, opts: TeleprinterOptions & StageOptions) {
  const teleprinter = new Teleprinter(opts);
  return { teleprinter, ...mountStage(canvas, teleprinter, opts) };
}
