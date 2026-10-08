import {
  type BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  type Camera,
  DirectionalLight,
  BackSide,
  Box3,
  Color,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  type Plane,
  Quaternion,
  Ray,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Sphere,
  type SkinnedMesh,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Face, type FaceLayout } from './face';
import { keyChars, type Layout, LAYOUTS, type LayoutName, POSITIONS } from './layouts';
import { dress, glowColour, type LookName, type Outfit, outlineUniforms } from './looks';
import { loadModel } from './model';
import { Paper, type Spot } from './paper';
import { type SoundEvent, type SoundName, Sounds } from './sound';
import { Spring, wobble } from './spring';
import SPEC from './typewriter.json';

export type { Spot } from './paper';

/**
 * The robot typewriter (blender/typewriter.py): a machine whose typebars swing up and
 * strike a sheet of paper, on whatever layout it is given (layouts.ts). Everything is posed live from
 * the springs each frame, like the crew. A strike is a chain of small things that happen
 * together: Shift drops the typebar basket, the key dips, its bar swings up (several may be
 * in the air at once) and hits, the ribbon guide lifts, the character lands on the paper at
 * the moment of impact, the spools tick and the carriage steps. The queue speeds up when
 * it grows, so a paste is over in half a second.
 *
 * The sheet is not in the model: it is a strip built along the paper's path (off the roll,
 * over the table, round the platen, past the print point, up through the bail), whose
 * texture slides with the feed so the typed lines travel round the platen and up.
 * Everything the machine measures is read from typewriter.json.
 */
export type Mood = 'idle' | 'typing' | 'happy' | 'puzzled' | 'asleep';

export interface TypewriterOptions {
  /** Where typewriter.glb is served from. */
  models: string;
  look?: LookName;
  /** What the keys type: one of LAYOUTS by name, or a layout of your own. */
  layout?: LayoutName | Layout;
  /** Its sounds' volume, 0 (silent) to 1 (mountTypewriter only). */
  volume?: number;
  reducedMotion?: boolean;
  /** Endless paper off a roll, rather than sheets. */
  endless?: boolean;
  /** A model to work instead of loading typewriter.glb, and a geometry block to use with
   * it (the lab's stand-in). */
  model?: Object3D | Promise<Object3D>;
  geometry?: Partial<Geometry>;
}

export interface Geometry {
  print: number[];
  strike: number;
  keyPress: number;
  shiftDrop: number;
  altDrop: number;
  platenAxis: number[];
  platenRadius: number;
  bail: number[];
  exitAngle: number;
  roll: number[];
  rollRadius: number;
  table: number[];
  tableTop?: number[];
  /** The sheet's left and right edges at rest (x, m). */
  paperX?: number[];
  /** Angles (rad) of the ribbon guide and the correction tape when they reach the print
   * point, the bell's swing, the lever's throw, the bail's lift, the gauge's range. */
  guideLift?: number;
  tapeLift?: number;
  bellSwing?: number;
  leverThrow?: number;
  bailLift?: number;
  needleRange?: number[];
  /** Every keycap's top at rest, for clicking keys: id -> [x, y, top z, half width, half
   * depth]. */
  keys?: Record<string, number[]>;
}

/** The screen face: wide, eyes either side of a small mouth (see faces.py LAYOUTS). */
const FACE: FaceLayout = {
  width: 512,
  height: 176,
  eyes: [
    [0.3, 0.42],
    [0.7, 0.42],
  ],
  rx: 0.06,
  ry: 0.26,
  line: 0.03,
  mouth: [0.5, 0.82],
};

const TYPE = SPEC.type;
const LINES = 64;
const TOP_LINES = 3;
const BOTTOM_LINES = 3;
const SHEET_COLUMNS = Math.round(TYPE.paperWidth / TYPE.pitch);
const SHEET_LENGTH = (TOP_LINES + LINES + BOTTOM_LINES) * TYPE.line;
const ROWS = Math.ceil(SHEET_LENGTH / 0.0065);
/** Endless paper: the lines it keeps (the paper's picture repeats every this many). */
const RING = 88;
/** Lines of free paper above the print point before its end curls back over the machine. */
const CURL_LINES = 9;
/** The curl's bend (rad per m) and how far on the path runs before it ends: old lines fold up
 * at its end, behind the machine. */
const CURL_BEND = 3.2;
const CURL_RUN = 0.98;
/** Lines above the print point that the wide camera keeps in frame. */
const FRAME_LINES = 9;
/** The paper bail is held up off the sheet (a share of its lift) so its rod and clamps do not
 * hide the lines above the print point; a line feed still kicks it. */
const BAIL_UP = 1.2;
/** The ink look's typebars (the joints' grey is too near the basket's black to read). */
const BAR_TONE = '#c9c9c1';
const BELL_COLUMN = TYPE.columns - 5;
/** Blank columns each side of the text on the sheet. */
const MARGIN = (SHEET_COLUMNS - TYPE.columns) / 2;

const BAR_IDS = SPEC.rows.flat();

interface Cell {
  id: string;
  /** What it types: plain, Shift, Alt Gr. */
  keys: string[];
  label?: string;
}

/** A layout's keys in the legend atlas's order (the character keys, then the others), and
 * what each character needs: its key, and 0 plain, 1 Shift, 2 Alt Gr. */
function keyboard(layout: Layout) {
  const cells: Cell[] = [
    ...POSITIONS.flatMap((row, r) =>
      row.map((id, k) => ({ id, keys: keyChars(layout.rows[r]?.[k] ?? '') })),
    ),
    ...SPEC.others.map((k) => ({ id: k.id, keys: [] as string[], label: k.label })),
  ];
  const chars = new Map<string, { id: string; mod: number }>();
  for (const c of cells) c.keys.forEach((ch, mod) => chars.has(ch) || chars.set(ch, { id: c.id, mod }));
  chars.set(' ', { id: 'space', mod: 0 });
  return { cells, chars };
}

/** Is the character a picture (an emoji) rather than a letter or a sign? */
export const isPicture = (ch: string) => /\p{Extended_Pictographic}/u.test(ch);

/** A bone that turns about one axis, from where it rests. `axis` is in the bone's frame. */
class Hinge {
  private rest: Quaternion;
  private q = new Quaternion();
  private last = 0;

  constructor(
    readonly bone: Object3D,
    private axis: Vector3,
  ) {
    this.rest = bone.quaternion.clone();
  }

  set(angle: number) {
    if (angle === this.last) return;
    this.last = angle;
    this.bone.quaternion.copy(this.rest).multiply(this.q.setFromAxisAngle(this.axis, angle));
  }
}

/** A bone that slides along one direction of the model's, from where it rests. */
class Slider {
  private rest: Vector3;
  private dir: Vector3;
  private last = 0;

  constructor(
    readonly bone: Object3D,
    model: Object3D,
    dir: Vector3,
  ) {
    this.rest = bone.position.clone();
    // The model's direction in the bone's parent's frame.
    const toParent = bone.parent!.matrixWorld.clone().invert().multiply(model.matrixWorld);
    this.dir = dir.clone().applyMatrix4(toParent).sub(new Vector3().applyMatrix4(toParent));
  }

  set(amount: number) {
    if (amount === this.last) return;
    this.last = amount;
    this.bone.position.copy(this.rest).addScaledVector(this.dir, amount);
  }
}

/**
 * The paper's path in the machine's side view, from the roll to well above the bail, as
 * a dense polyline (u toward the typist, v up, metres). It runs from the roll up to the
 * table, down the back of the platen, under it and up its front past the print point,
 * through the bail and out at the exit angle; far enough up it curls back over the machine.
 */
class Route {
  readonly ds = 0.004;
  readonly count: number;
  readonly length: number;
  /** Where on the path the print point is (m from the roll). */
  readonly printAt: number;
  /** How far the print point is from the path (m): more than a few mm is a modelling slip. */
  readonly miss: number;
  /** Where the paper passes the bail (m from the roll): above it the sheet is in the air. */
  readonly exitAt: number;
  private p: Float32Array;
  private t: Float32Array;

  constructor(g: Geometry) {
    const C = [-g.platenAxis[0], g.platenAxis[1]];
    const rho = g.platenRadius + 0.0014;
    const R = [-g.roll[0], g.roll[1]];
    const T = [-g.table[0], g.table[1]];
    const B = [-g.bail[0], g.bail[1]];
    const raw: number[] = [];
    const add = (u: number, v: number) => raw.push(u, v);
    const line = (a: number[], b: number[]) => {
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / this.ds));
      for (let i = 0; i < n; i++)
        add(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n);
    };
    // The roll, up to its top, and on to the table.
    const TT = g.tableTop ? [-g.tableTop[0], g.tableTop[1]] : null;
    if (TT) {
      line(R, TT);
      line(TT, T);
    } else {
      const top = [R[0], R[1] + g.rollRadius * 0.97];
      line(R, top);
      line(top, T);
    }
    // The point of the platen where the line from `X` touches it, going round anticlockwise
    // (down the back, up the front).
    const touch = (X: number[], leaving: boolean) => {
      const d = Math.hypot(X[0] - C[0], X[1] - C[1]);
      const a0 = Math.atan2(X[1] - C[1], X[0] - C[0]);
      const delta = Math.acos(Math.min(1, rho / d));
      for (const th of [a0 + delta, a0 - delta]) {
        const A = [C[0] + rho * Math.cos(th), C[1] + rho * Math.sin(th)];
        const along = (A[0] - X[0]) * -Math.sin(th) + (A[1] - X[1]) * Math.cos(th);
        if (leaving ? along < 0 : along > 0) return th;
      }
      return a0;
    };
    const th0 = touch(T, false);
    let th1 = touch(B, true);
    while (th1 < th0) th1 += Math.PI * 2;
    const at = (th: number) => [C[0] + rho * Math.cos(th), C[1] + rho * Math.sin(th)];
    const steps = Math.max(2, Math.ceil((rho * (th1 - th0)) / this.ds));
    for (let i = 0; i < steps; i++)
      add(...(at(th0 + ((th1 - th0) * i) / steps) as [number, number]));
    const L = at(th1);
    line(L, B);
    add(B[0], B[1]);

    // Evenly spaced along the paper's length, so a line is as tall everywhere on the path.
    const pts: number[] = [];
    let carried = 0;
    pts.push(raw[0], raw[1]);
    for (let i = 2; i < raw.length; i += 2) {
      const seg = Math.hypot(raw[i] - raw[i - 2], raw[i + 1] - raw[i - 1]);
      let used = 0;
      while (carried + (seg - used) >= this.ds && seg > 0) {
        used += this.ds - carried;
        carried = 0;
        const k = used / seg;
        pts.push(
          raw[i - 2] + (raw[i] - raw[i - 2]) * k,
          raw[i - 1] + (raw[i + 1] - raw[i - 1]) * k,
        );
      }
      carried += seg - used;
    }
    // The print point on the path: its nearest vertex.
    const P = [-g.print[1], g.print[2]];
    let best = Infinity;
    let nearest = 0;
    for (let i = 0; i < pts.length / 2; i++) {
      const d = Math.hypot(pts[i * 2] - P[0], pts[i * 2 + 1] - P[1]);
      if (d < best) [best, nearest] = [d, i];
    }
    this.printAt = nearest * this.ds;
    this.miss = best;

    // On through the bail, turning to the exit angle, then curling back over the machine
    // from the curl line up.
    const into = Math.atan2(B[1] - L[1], B[0] - L[0]);
    let turn = Math.atan2(Math.cos(g.exitAngle), -Math.sin(g.exitAngle)) - into;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const curlFrom = this.printAt + CURL_LINES * TYPE.line;
    let u = pts[pts.length - 2];
    let v = pts[pts.length - 1];
    const start = (pts.length / 2 - 1) * this.ds;
    this.exitAt = start;
    for (let s = start; s < curlFrom + CURL_RUN; s += this.ds) {
      const k = Math.min(1, (s - start) / 0.08);
      const h = into + turn * k * k * (3 - 2 * k) + Math.max(0, s - curlFrom) * CURL_BEND;
      u += Math.cos(h) * this.ds;
      v += Math.sin(h) * this.ds;
      pts.push(u, v);
    }
    this.count = pts.length / 2;
    this.length = (this.count - 1) * this.ds;
    this.p = new Float32Array(pts);
    this.t = new Float32Array(pts.length);
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(this.count - 1, i + 1);
      const du = this.p[b * 2] - this.p[a * 2];
      const dv = this.p[b * 2 + 1] - this.p[a * 2 + 1];
      const n = Math.hypot(du, dv) || 1;
      this.t[i * 2] = du / n;
      this.t[i * 2 + 1] = dv / n;
    }
  }

  /** The path at `s` metres from the roll: position (u, v) and the unit direction of
   * travel (tu, tv). */
  at(s: number, out: { u: number; v: number; tu: number; tv: number }) {
    const x = Math.min(Math.max(s / this.ds, 0), this.count - 1.0001);
    const i = Math.floor(x);
    const f = x - i;
    const { p, t } = this;
    out.u = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * f;
    out.v = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * f;
    const tu = t[i * 2] + (t[i * 2 + 2] - t[i * 2]) * f;
    const tv = t[i * 2 + 1] + (t[i * 2 + 3] - t[i * 2 + 1]) * f;
    const n = Math.hypot(tu, tv) || 1;
    out.tu = tu / n;
    out.tv = tv / n;
  }
}

/** The keycaps' legends on an 8x8 atlas, in the colours of the look. */
function legendAtlas(look: LookName, cells: Cell[], old?: CanvasTexture): CanvasTexture {
  const cell = 96;
  const canvas = old ? (old.image as HTMLCanvasElement) : document.createElement('canvas');
  canvas.width = canvas.height = cell * SPEC.atlas.columns;
  const c = canvas.getContext('2d')!;
  const dark = look === 'ink';
  c.fillStyle = dark ? '#1c1c1b' : '#f4f4f1';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = dark ? '#f4f4f1' : '#111111';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const face = (px: number) => `700 ${px}px "Maple Mono", ui-monospace, system-ui, sans-serif`;
  // The cap's top is the cell's inscribed circle: a legend fills about two thirds of it.
  cells.forEach((k, i) => {
    const x = (i % SPEC.atlas.columns) * cell;
    const y = Math.floor(i / SPEC.atlas.columns) * cell;
    const cx = x + cell / 2;
    const cy = y + cell / 2;
    const [plain, shift, alt] = k.keys;
    if (!plain) {
      if (k.label) {
        c.font = face(k.label.length > 2 ? 40 : 62);
        c.fillText(k.label, cx, cy + 2, cell * 0.74);
      }
      return;
    }
    if (/^\p{L}$/u.test(plain) && shift === plain.toUpperCase()) {
      c.font = face(74);
      c.fillText(plain.toUpperCase(), cx, cy + 3);
    } else {
      // Figures and signs: the plain one large, the shifted one above it.
      c.font = face(shift ? 56 : 70);
      c.fillText(plain, cx, shift ? cy + cell * 0.2 : cy + 2);
      if (shift) {
        c.font = face(44);
        c.fillText(shift, cx, cy - cell * 0.22);
      }
    }
    if (alt) {
      c.font = face(32);
      c.fillText(alt, x + cell * 0.8, y + cell * 0.78);
    }
  });
  const texture = old ?? new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false; // glTF UVs start at the top left
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

interface Bar {
  hinge: Hinge | null;
  spring: Spring;
  /** 0 at rest, 1 on its way up (t < 0 while it waits), 2 coming back. */
  state: 0 | 1 | 2;
  t: number;
  dur: number;
  /** How far it swings at the strike (rad): a touch more when the basket is dropped. */
  peak: number;
  ch: string;
  at: Spot;
  ink?: string;
}

interface Key {
  hinge: Hinge | null;
  spring: Spring;
  until: number;
  x: number;
}

type Job =
  | { kind: 'strike'; ch: string; at: Spot; ink?: string }
  | { kind: 'erase'; at: Spot }
  | { kind: 'move'; at: Spot }
  | { kind: 'put'; at: Spot; ch: string | null; ink?: string }
  | { kind: 'ding' }
  | { kind: 'send'; done: () => void };

/** A sheet that has been torn off and is flying away. */
interface Flyer {
  holder: Group;
  meshes: Mesh[];
  texture: CanvasTexture;
  t: number;
  x: Spring;
  y: Spring;
  tilt: Spring;
}

/** The light on the page would blow white paper out: a touch of grey keeps the type's tones. */
const PAPER_TINT = '#e6e6e2';
/** How far the flag turns back to lie down (rad). */
const FLAG_DOWN = Math.PI / 2;
/** And how far its plate turns about the arm, to lie along the side (rad). */
const PLATE_TURN = -Math.PI / 2;

/** A raised flag: its colour, and a number or a word on it in its ink. */
export interface Flag {
  colour: string;
  label?: string;
  ink?: string;
}

/** The typebars' length (m), for how much further they swing with the basket dropped. */
const BAR_LENGTH = 0.3;
const JOB_GAP = 0.105;
const MAX_LAG = 0.45;
/** The physics runs in fixed steps, whatever the frame rate (s). */
const STEP = 1 / 120;
/** The carriage on a run (a return, a tab): how hard it gathers speed (columns/s²) and its
 * top speed (columns/s). On a return the lever turns the platen first, for this long (s). */
const RUN_ACCEL = 1100;
const RUN_MAX = 170;
const FEED_FIRST = 0.07;
/** How fast the escapement lets the carriage on (columns/s): a step is all but at once. */
const ESCAPE = 400;
/** The machine's half width (m), for where across it a sound comes from. */
const HALF_WIDTH = 0.72;

/** How long a run of `d` columns takes from a standstill to the stop (s). */
function runTime(d: number) {
  const reach = (RUN_MAX * RUN_MAX) / (2 * RUN_ACCEL);
  return d < reach ? Math.sqrt((2 * d) / RUN_ACCEL) : RUN_MAX / RUN_ACCEL + (d - reach) / RUN_MAX;
}

export class Typewriter {
  readonly group = new Group();
  readonly ready: Promise<void>;
  readonly paper: Paper;
  reducedMotion: boolean;
  /** Told of every sound the machine makes (sound.ts plays them). */
  onSound: ((e: SoundEvent) => void) | null = null;
  /** The camera the gaze works out where the face is on the screen with (mountTypewriter
   * sets it). */
  camera: Camera | null = null;
  /** The whole machine (and the paper to the curl line) in the group's space, once loaded. */
  readonly bounds = new Box3();
  /** Endless paper off a roll (else sheets), and the strip's rows along the paper's path. */
  readonly endless: boolean;
  private rows = ROWS;
  /** The print point in the group's space. */
  readonly printPoint = new Vector3();
  private geo: Geometry;
  /** The sheet's left edge at rest (x, m). */
  readonly x0: number;
  private route: Route;
  private look_: LookName;
  private outfit: Outfit | null = null;
  /** The planes it is cut to (coming up through the floor on its table), if any. */
  private planes: Plane[] | null = null;
  private model: Object3D | null = null;
  private face = new Face('#f4f4f1', FACE);
  private legend: CanvasTexture | null = null;
  private layout_: Layout;
  private cells: Cell[];
  private chars: Map<string, { id: string; mod: number }>;
  private legendMat: MeshStandardMaterial | null = null;
  private rollMat: MeshStandardMaterial | null = null;

  // Bones.
  private bars = new Map<string, Bar>();
  private keys = new Map<string, Key>();
  private segment: Slider | null = null;
  private guide: Hinge | null = null;
  private tape: Hinge | null = null;
  private carriage: Slider | null = null;
  private body: Slider | null = null;
  private bodyTilt: Hinge | null = null;
  private platen: Hinge | null = null;
  private roll: Hinge | null = null;
  private bail: Hinge | null = null;
  private lever: Hinge | null = null;
  private bell: Hinge | null = null;
  private needle: Hinge | null = null;
  // The flag on the side: up (with its colour and its number) or down, and its springs.
  private flagHinge: Hinge | null = null;
  private flagS = new Spring(7, 0.45, -FLAG_DOWN);
  private flagPlate: Hinge | null = null;
  private plateS = new Spring(9, 0.6, PLATE_TURN);
  private flagUp: Flag | null = null;
  private flagMat: MeshStandardMaterial | null = null;
  private flagTex: CanvasTexture | null = null;
  private decorBones = new Map<string, Object3D>();
  private decorOn: string[] | null = null;
  private ribbonMat: MeshStandardMaterial | null = null;
  private ribbonInk: string | null = null;
  /** The colour look's palette (palettes.json): the machine's own, or one of its variants. */
  private palette = 'typewriter';
  private spools: Hinge[] = [];

  // Springs. The carriage's is stiff and a little lively: an escapement step is a snap
  // with a shiver after it, and a run that hits the stop bounces off it.
  private carX = new Spring(15, 0.4, 0.5);
  private carCalm = new Spring(14, 1, 0);
  private feed = new Spring(10, 0.65, 0.2);
  private feedCalm = new Spring(12, 1, 0);
  private seg = new Spring(12, 0.8, 0);
  private guideS = new Spring(16, 0.6, 0);
  private tapeS = new Spring(14, 0.65, 0);
  private spool = new Spring(9, 0.8, 0);
  private leverS = new Spring(6, 0.5, 0);
  private bailS = new Spring(8, 0.6);
  private bobS = new Spring(5, 0.35);
  private needleS = new Spring(2.5, 0.5);
  private gazeX = new Spring(3.5, 0.8, 0);
  private gazeY = new Spring(3.5, 0.8, 0);

  // The sheet.
  private sheet = new Group();
  private geometry: BufferGeometry | null = null;
  private front: Mesh | null = null;
  private back: Mesh | null = null;
  private frontMat: MeshStandardMaterial;
  private backMat: MeshStandardMaterial;
  private fed = NaN;
  private flyer: Flyer | null = null;
  private fade = 1;
  private ray = new Raycaster();
  private hit = new Vector2();
  private local = new Ray();
  private inverse = new Matrix4();
  /** Keys held down by the page (Shift clicked, Shift Lock on). */
  private held = new Set<string>();

  // The queue and where the machine is going.
  private jobs: Job[] = [];
  private head = 0;
  private clock = 0;
  private next = 0;
  private tempo = 1;
  private inflight = 0;
  private tCol = 15;
  private tLine = 0;
  private rCol = 15;
  private rLine = 0;
  /** The carriage's speed on a run (columns/s, signed), and the run, if it's on one. */
  private vCol = 0;
  private carRun: { wait: number } | null = null;
  private feedRate = 30;
  /** Time not yet stepped (s), and where the gaze is going. */
  private acc = 0;
  private gaze = { x: 0, y: 0 };
  private caretAt: Spot | null = null;
  private idleFor = 0;
  private lastStrike = -10;
  private segLevel = 0;
  private serial = 0;
  private spoolAngle = 0;
  private leverUntil = 0;
  private guideUntil = 0;
  private tapeRun: { t: number; dur: number; at: Spot; cleared: boolean } | null = null;
  private bellT = -1;
  private sending: { t: number; phase: number; done: () => void } | null = null;
  private moodNow: Mood = 'idle';
  private pointer: { x: number; y: number } | null = null;
  private faceAt = new Vector3();
  private tmp = new Vector3();
  private ndcTmp = new Vector3();
  private sample = { u: 0, v: 0, tu: 0, tv: 0 };
  private missing: string[] = [];

  constructor(opts: TypewriterOptions) {
    this.reducedMotion = !!opts.reducedMotion;
    this.endless = !!opts.endless;
    this.look_ = opts.look ?? 'ink';
    this.layout_ = LAYOUTS['us-qwerty'];
    ({ cells: this.cells, chars: this.chars } = keyboard(this.layout_));
    if (opts.layout) this.setLayout(opts.layout);
    this.geo = { ...(SPEC.geometry as Geometry), ...opts.geometry };
    this.x0 = this.geo.paperX?.[0] ?? -MARGIN * TYPE.pitch;
    this.route = new Route(this.geo);
    if (this.endless) this.rows = Math.ceil(this.route.length / 0.0065);
    this.paper = new Paper(
      {
        columns: TYPE.columns,
        lines: LINES,
        sheetColumns: SHEET_COLUMNS,
        topLines: TOP_LINES,
        bottomLines: BOTTOM_LINES,
        ring: this.endless ? RING : 0,
      },
      TYPE.line / TYPE.pitch,
    );
    this.frontMat = new MeshStandardMaterial({
      map: this.paper.texture,
      color: PAPER_TINT,
      roughness: 0.95,
      alphaTest: 0.85,
    });
    this.backMat = new MeshStandardMaterial({ color: '#dcdcd8', roughness: 0.95, side: BackSide });
    this.face.expression = 'neutral';
    for (const id of BAR_IDS)
      this.bars.set(id, {
        hinge: null,
        spring: new Spring(9, 0.9),
        state: 0,
        t: 0,
        dur: 0.07,
        peak: 0,
        ch: '',
        at: { line: 0, col: 0 },
      });
    for (const k of this.cells)
      this.keys.set(k.id, { hinge: null, spring: new Spring(16, 0.75, 0), until: 0, x: 0 });
    const model = opts.model ?? loadModel(`${opts.models}typewriter.glb`);
    this.ready = Promise.all([
      Promise.resolve(model).then((m) => this.mount(m)),
      this.paper.ready,
    ]).then(() => undefined);
  }

  get busy() {
    return this.head < this.jobs.length || this.inflight > 0 || !!this.sending || !!this.tapeRun;
  }

  private mount(model: Object3D) {
    this.model = model;
    this.group.add(model);
    this.group.updateMatrixWorld(true);
    const find = (name: string, must = false) => {
      const b = model.getObjectByName(name);
      if (!b && must) throw new Error(`typewriter: no bone ${name}`);
      if (!b) this.missing.push(name);
      return b ?? null;
    };
    const X = new Vector3(1, 0, 0);
    const Y = new Vector3(0, 1, 0);
    // Every joint turns about its bone's own X (the spools about their length).
    const hinge = (name: string, axis = X) => {
      const b = find(name);
      return b ? new Hinge(b, axis) : null;
    };
    const slider = (name: string, dir: Vector3, must = false) => {
      const b = find(name, must);
      return b ? new Slider(b, model, dir) : null;
    };
    this.carriage = slider('carriage', X, true);
    this.segment = slider('segment', Y, true);
    this.body = slider('body', Y);
    this.bodyTilt = hinge('body');
    this.guide = hinge('guide');
    this.tape = hinge('tape');
    this.platen = hinge('platen');
    this.roll = hinge('roll');
    this.bail = hinge('bail');
    this.lever = hinge('lever');
    this.bell = hinge('bell');
    this.needle = hinge('needle');
    this.flagHinge = hinge('flag');
    this.flagPlate = hinge('flagPlate', Y);
    model.traverse((o) => {
      if (o.name.startsWith('decor_')) this.decorBones.set(o.name.slice(6), o);
    });
    this.decor(this.decorOn ?? []);
    this.spools = ['spoolL', 'spoolR'].map((n) => hinge(n, Y)).filter((h): h is Hinge => !!h);
    const shoot = new Vector3();
    for (const [id, bar] of this.bars) bar.hinge = hinge(`bar_${id}`);
    for (const [id, key] of this.keys) {
      key.hinge = hinge(`key_${id}`);
      if (key.hinge) key.x = model.worldToLocal(key.hinge.bone.getWorldPosition(shoot)).x;
    }
    if (this.missing.length)
      console.warn(`typewriter: model lacks bones ${this.missing.join(', ')}`);
    if (this.route.miss > 0.008)
      console.warn(
        `typewriter: the print point is ${(this.route.miss * 1000).toFixed(0)} mm off the paper's path`,
      );

    // The sheet rides the carriage, which slides along the model's X. It hangs on the group,
    // not in the model, which the dressing would put the machine's materials on.
    this.group.add(this.sheet);
    this.buildSheet();

    // Where the print point is, and how much room the machine and its paper take.
    this.printPoint.set(0, this.geo.print[2], -this.geo.print[1]);
    this.bounds.setFromObject(model);
    const s = { u: 0, v: 0, tu: 0, tv: 0 };
    this.route.at(this.route.printAt + (FRAME_LINES + 0.5) * TYPE.line, s);
    this.bounds.expandByPoint(this.tmp.set(this.x0, s.v, s.u));
    this.bounds.expandByPoint(this.tmp.set(this.x0 + TYPE.paperWidth, s.v, s.u));
    this.tCol = this.rCol = 0;
    this.feed.snap(this.startFeed());
    this.feedCalm.snap(this.startFeed());
    this.tLine = this.rLine = 0;
    this.dress(this.look_);
    // The face's middle in the group's space, for the gaze.
    const screen = this.meshes('Screen')[0];
    if (screen) this.faceAt.copy(new Box3().setFromObject(screen).getCenter(new Vector3()));
    this.shape(true);
  }

  /** The feed that has the sheet just off the roll (nothing of it showing). */
  private startFeed() {
    if (this.endless) return 0;
    return -(this.route.printAt / TYPE.line + TOP_LINES + 1);
  }

  private meshes(role: string): Mesh[] {
    const found: Mesh[] = [];
    this.model?.traverse((o) => {
      if ((o as Mesh).isMesh && o.userData.role === role && !o.userData.outline)
        found.push(o as Mesh);
    });
    return found;
  }

  /** In the ink look the typebars are the same grey as the joints round them, on a near-black
   * basket, and vanish: the vertices that belong to a bar (by their bone) are drawn lighter,
   * and everything else of that material keeps its tone. */
  private lightenBars(look: LookName) {
    if (look !== 'ink') return;
    const bar = new Color(BAR_TONE);
    for (const mesh of this.meshes('Joint')) {
      const geometry = mesh.geometry;
      const index = geometry.getAttribute('skinIndex');
      const skeleton = (mesh as SkinnedMesh).skeleton;
      const material = mesh.material as MeshStandardMaterial;
      if (!index || !skeleton || !material.color) continue;
      const rest = material.color.clone();
      const ratio = new Color(rest.r / bar.r, rest.g / bar.g, rest.b / bar.b);
      const colours = new Float32Array(index.count * 3);
      for (let i = 0; i < index.count; i++) {
        const isBar = skeleton.bones[index.getX(i)]?.name.startsWith('bar_');
        colours.set(isBar ? [1, 1, 1] : [ratio.r, ratio.g, ratio.b], i * 3);
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
      material.color.copy(bar);
      material.vertexColors = true;
      material.needsUpdate = true;
    }
  }

  dress(look: LookName) {
    this.look_ = look;
    const model = this.model;
    if (!model) return;
    this.outfit?.dispose();
    this.outfit = dress(model, look, { screen: this.face.texture, model: this.palette });
    this.face.setGlow(glowColour.value ?? '#f4f4f1');
    // The keycaps carry their legends: their own material, swapped in after the dressing.
    this.legend = legendAtlas(look, this.cells, this.legend ?? undefined);
    this.legendMat ??= new MeshStandardMaterial({ map: this.legend, roughness: 0.6 });
    for (const m of this.meshes('Legend')) m.material = this.legendMat;
    this.lightenBars(look);
    // The paper roll is paper, not a lamp.
    this.rollMat ??= new MeshStandardMaterial({ color: PAPER_TINT, roughness: 0.95 });
    for (const m of this.meshes('Glow_Paper')) m.material = this.rollMat;
    this.flagMat ??= new MeshStandardMaterial({ roughness: 0.7 });
    this.paintFlag();
    for (const m of this.meshes('Flag')) m.material = this.flagMat;
    if (this.ribbonInk) this.ribbon(this.ribbonInk);
    document.fonts
      ?.load('40px "Maple Mono"')
      .then(() => this.legend && legendAtlas(this.look_, this.cells, this.legend))
      .catch(() => undefined);
    this.clip(this.planes);
  }

  /** Cut it to these planes (as it comes up through a hole in the floor), or not (null). */
  clip(planes: Plane[] | null) {
    this.planes = planes;
    const own = [this.legendMat, this.rollMat, this.flagMat, this.ribbonMat, this.frontMat, this.backMat];
    for (const m of [...(this.outfit?.materials ?? []), ...own]) if (m) m.clippingPlanes = planes;
  }

  /** The sheet's two meshes (the typed side, and its back) on one strip of vertices. */
  private buildSheet() {
    const geometry = (this.geometry = new BufferGeometry());
    const rows = this.rows;
    const n = rows * 2;
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < rows; j++) {
      const v = j / (rows - 1);
      uv.set([0, v, 1, v], j * 4);
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    const index: number[] = [];
    for (let j = 0; j < rows - 1; j++) {
      const a = j * 2;
      index.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    geometry.setIndex(new Uint16BufferAttribute(index, 1));
    // The strip moves all the time: its bounds are the machine's room, not its vertices'.
    geometry.boundingSphere = new Sphere(new Vector3(0, 0.8, 0), 4);
    this.front = new Mesh(geometry, this.frontMat);
    this.back = new Mesh(geometry, this.backMat);
    for (const m of [this.front, this.back]) {
      m.frustumCulled = false;
      this.sheet.add(m);
    }
  }

  /** Lays the strip along the path for the feed it is at now. */
  private shape(force = false) {
    const geometry = this.geometry;
    if (!geometry) return;
    const feed = this.feed.y;
    if (!force && Math.abs(feed - this.fed) < 1e-5) return;
    this.fed = feed;
    this.lay(geometry, feed, 0);
  }

  /** Lays a strip along the path for a feed, with nothing of it below `floor` (m along the
   * path): the rest of the strip is folded up on that spot. */
  private lay(geometry: BufferGeometry, feed: number, floor: number) {
    const pos = geometry.getAttribute('position') as BufferAttribute;
    const nor = geometry.getAttribute('normal') as BufferAttribute;
    const sTop = this.route.printAt + (TOP_LINES + feed + 0.5) * TYPE.line;
    const r = this.route;
    const s = this.sample;
    const x0 = this.x0;
    const x1 = x0 + TYPE.paperWidth;
    const rows = this.rows;
    // Endless paper lies along the whole path, and its picture slides through it instead.
    const uv = this.endless ? (geometry.getAttribute('uv') as BufferAttribute) : null;
    for (let j = 0; j < rows; j++) {
      const along = uv
        ? r.length * (1 - j / (rows - 1))
        : sTop - (j / (rows - 1)) * SHEET_LENGTH;
      if (uv) {
        const v = (feed + 0.5 + (r.printAt - along) / TYPE.line) / RING;
        uv.setY(j * 2, v);
        uv.setY(j * 2 + 1, v);
      }
      r.at(Math.max(floor, along), s);
      // The typed side faces out from the platen: to the right of the way the paper runs.
      pos.setXYZ(j * 2, x0, s.v, s.u);
      pos.setXYZ(j * 2 + 1, x1, s.v, s.u);
      nor.setXYZ(j * 2, 0, -s.tu, s.tv);
      nor.setXYZ(j * 2 + 1, 0, -s.tu, s.tv);
    }
    pos.needsUpdate = nor.needsUpdate = true;
    if (uv) uv.needsUpdate = true;
  }

  // ---- What the page asks for ----------------------------------------------------------

  /** Raise the flag in a colour, with a number or a word on it, or lower it (null). */
  flag(up: Flag | null) {
    const was = this.flagUp;
    if (was?.colour === up?.colour && was?.label === up?.label) return;
    this.flagUp = up;
    if (up) this.paintFlag();
    if (!!was !== !!up) this.sound(up ? 'lever' : 'shift', 0.6, 0.8);
    else this.flagS.kick(-3);
  }

  private paintFlag() {
    const up = this.flagUp;
    if (!this.flagMat) return;
    const canvas = (this.flagTex?.image as HTMLCanvasElement) ?? document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 128;
    const c = canvas.getContext('2d')!;
    c.fillStyle = up?.colour ?? '#7a7a74';
    c.fillRect(0, 0, canvas.width, canvas.height);
    if (up?.label) {
      c.fillStyle = up.ink ?? '#111111';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${up.label.length > 2 ? 54 : 92}px "Maple Mono", ui-monospace, monospace`;
      c.fillText(up.label, canvas.width / 2, canvas.height / 2 + 6, canvas.width * 0.86);
    }
    if (!this.flagTex) {
      this.flagTex = new CanvasTexture(canvas);
      this.flagTex.colorSpace = SRGBColorSpace;
      this.flagTex.flipY = false;
      this.flagMat.map = this.flagTex;
      this.flagMat.needsUpdate = true;
    }
    this.flagTex.needsUpdate = true;
  }

  /** Which decor the machine wears (antenna, stickers, horn, lamp): the rest is left off. */
  decor(names: string[]) {
    this.decorOn = names;
    for (const [name, bone] of this.decorBones) bone.scale.setScalar(names.includes(name) ? 1 : 1e-4);
  }

  /** The colour look's palette: the machine's own ('typewriter') or a variant's. */
  repaint(palette: string) {
    this.palette = palette;
    this.dress(this.look_);
  }

  /** The ribbon's colour (its lower half), or the look's again (null). */
  ribbon(ink: string | null) {
    const was = this.ribbonInk;
    this.ribbonInk = ink;
    if (!ink) {
      if (was) this.dress(this.look_);
      return;
    }
    this.ribbonMat ??= new MeshStandardMaterial({ roughness: 0.55 });
    this.ribbonMat.color.set(ink);
    for (const m of this.meshes('Bezel_Ribbon')) m.material = this.ribbonMat;
  }

  /** What the keys type now. */
  get layout(): Layout {
    return this.layout_;
  }

  /** Change what the keys type: the legends are drawn again at once. */
  setLayout(layout: LayoutName | Layout) {
    this.layout_ = typeof layout === 'string' ? (LAYOUTS[layout] ?? LAYOUTS['us-qwerty']) : layout;
    ({ cells: this.cells, chars: this.chars } = keyboard(this.layout_));
    if (this.legend) legendAtlas(this.look_, this.cells, this.legend);
  }

  /** Has a character a typebar of its own? Others are struck by the nearest one. */
  private barFor(ch: string) {
    const known = this.chars.get(ch);
    if (known && known.id !== 'space') return known;
    let h = 0;
    for (const c of ch) h = (h * 31 + c.codePointAt(0)!) >>> 0;
    return { id: BAR_IDS[h % BAR_IDS.length], mod: 0 };
  }

  /** Queued: a character struck at a spot, in the machine's ink or another ribbon's. */
  strike(ch: string, at: Spot, ink?: string) {
    this.jobs.push({ kind: 'strike', ch, at, ink });
  }

  erase(at: Spot) {
    this.jobs.push({ kind: 'erase', at });
  }

  move(at: Spot) {
    this.jobs.push({ kind: 'move', at });
  }

  ding() {
    this.jobs.push({ kind: 'ding' });
  }

  /** Queued: set a spot to a character, or clear it (null), at once and without the
   * machine, when the queue gets there; so it can't be struck over by a strike queued
   * before it. For text the page moves in bulk. */
  put(at: Spot, ch: string | null, ink?: string) {
    this.jobs.push({ kind: 'put', at, ch, ink });
  }

  send(): Promise<void> {
    return new Promise((done) => this.jobs.push({ kind: 'send', done }));
  }

  caret(at: Spot | null) {
    this.caretAt = at;
    this.paper.caret(at);
  }

  look(ndc: { x: number; y: number } | null) {
    this.pointer = ndc;
  }

  mood(m: Mood) {
    this.moodNow = m;
  }

  /** The spot of the paper under the pointer (NDC), or null. */
  pick(ndc: { x: number; y: number }, camera: Camera): Spot | null {
    if (!this.front) return null;
    this.group.updateMatrixWorld(true);
    this.ray.setFromCamera(this.hit.set(ndc.x, ndc.y), camera);
    const hit = this.ray.intersectObject(this.front, false)[0];
    if (!hit?.uv) return null;
    const col = Math.floor((hit.uv.x * TYPE.paperWidth) / TYPE.pitch - MARGIN);
    const line = this.endless
      ? Math.floor(hit.uv.y * RING)
      : Math.floor(hit.uv.y * (SHEET_LENGTH / TYPE.line) - TOP_LINES);
    const last = this.endless ? Infinity : LINES - 1;
    if (col < -2 || col > TYPE.columns + 1 || line < -1 || line > last + 1) return null;
    return {
      col: Math.min(Math.max(col, 0), TYPE.columns - 1),
      line: Math.min(Math.max(line, 0), last),
    };
  }

  /** The key under the pointer (NDC), or null: its id, and what it types (plain, with
   * Shift, with Alt Gr). */
  keyAt(ndc: { x: number; y: number }, camera: Camera): { id: string; keys: string[] } | null {
    const caps = this.geo.keys;
    if (!caps || !this.model) return null;
    this.group.updateMatrixWorld(true);
    this.ray.setFromCamera(this.hit.set(ndc.x, ndc.y), camera);
    const { origin: o, direction: d } = this.local
      .copy(this.ray.ray)
      .applyMatrix4(this.inverse.copy(this.group.matrixWorld).invert());
    if (d.y > -1e-6) return null;
    const PAD = 0.004;
    let best: string | null = null;
    let near = Infinity;
    for (const id in caps) {
      const [x, y, top, hx, hy] = caps[id];
      // The cap's top, and a plane a little under it so its sides count too. Blender's
      // (x, y, z) is the model's (x, -z, y).
      for (const z of [top, top - 0.016]) {
        const t = (z - o.y) / d.y;
        if (t <= 0 || t >= near) continue;
        const dx = (o.x + d.x * t - x) / (hx + PAD);
        const dy = (-(o.z + d.z * t) - y) / (hy + PAD);
        const inside = hx > hy * 1.2 ? Math.abs(dx) <= 1 && Math.abs(dy) <= 1 : dx * dx + dy * dy <= 1;
        if (inside) {
          best = id;
          near = t;
        }
      }
    }
    if (!best) return null;
    return { id: best, keys: this.cells.find((c) => c.id === best)?.keys ?? [] };
  }

  /** Hold a key down (Shift clicked, Shift Lock on), or let it up. */
  hold(id: string, down: boolean) {
    if (this.held.has(id) === down) return;
    if (down) this.held.add(id);
    else this.held.delete(id);
    this.keySound(id, down ? 0.6 : 0.3);
  }

  /** A spot in NDC. */
  project(at: Spot, camera: Camera): { x: number; y: number } {
    const p = this.spotPoint(at, this.ndcTmp).project(camera);
    return { x: p.x, y: p.y };
  }

  /** A spot's middle on the sheet, in world space. */
  private spotPoint(at: Spot, out: Vector3) {
    const sTop = this.route.printAt + (TOP_LINES + this.feed.y + 0.5) * TYPE.line;
    this.route.at(sTop - (TOP_LINES + at.line + 0.5) * TYPE.line, this.sample);
    out.set(this.x0 + (MARGIN + at.col + 0.5) * TYPE.pitch, this.sample.v, this.sample.u);
    return this.sheet.localToWorld(out);
  }

  /** The carriage's position along the rail (m, from its rest) now. */
  get carriageX() {
    return this.carX.y;
  }

  // ---- The queue ----------------------------------------------------------------------

  /** Where the carriage goes for a column (m from its rest: the sheet slides left as the
   * columns go up). */
  private xOf(col: number) {
    return -(this.x0 + (MARGIN + col + 0.5) * TYPE.pitch);
  }

  /** Sends the carriage and the platen to a spot; returns how long that takes (s). A step
   * or two is the escapement's; further is a run: thrown back to the margin for a return
   * (the lever turns the platen first), or let go to a tab stop, gathering speed until it
   * hits the stop. */
  private aim(col: number, line: number) {
    const dc = col - this.tCol;
    const dl = line - this.tLine;
    this.tCol = Math.min(Math.max(col, 0), TYPE.columns);
    this.tLine = Math.min(Math.max(line, 0), this.endless ? Infinity : LINES - 1);
    // Blank paper ready below the line, up from the roll.
    this.paper.reserve(this.tLine + Math.ceil(this.route.printAt / TYPE.line) + 2);
    this.serial++;
    let seconds = 0;
    if (Math.abs(dc) > 5) {
      const back = dc < 0;
      const wait = back && dl !== 0 ? FEED_FIRST : 0;
      this.carRun = { wait };
      seconds = wait + runTime(Math.abs(this.tCol - this.rCol)) + 0.05;
      if (back) {
        this.leverUntil = this.clock + seconds * 0.8;
        this.pressKey('ret', 0.25);
        this.sound('lever', 0.8, 0.6);
      } else {
        this.pressKey('tab', 0.2);
        this.keySound('tab');
      }
    } else {
      this.carRun = null;
      this.vCol = 0;
      seconds = Math.abs(dc) > 1 ? 0.06 : 0;
    }
    if (dl !== 0) {
      seconds = Math.max(seconds, 0.14);
      this.feedRate = Math.abs(dl) > 4 ? 26 : 40;
      this.bailS.kick(3.5);
    }
    return seconds;
  }

  private sound(name: SoundName, gain = 1, pan = 0) {
    this.onSound?.({ name, gain, pan });
  }

  /** A key's sound, from where it is across the machine. */
  private keySound(id: string, gain = 0.6) {
    const x = this.keys.get(id)?.x ?? 0;
    this.sound(id === 'space' ? 'space' : 'key', gain, -x / HALF_WIDTH);
  }

  private pressKey(id: string, seconds: number) {
    const k = this.keys.get(id);
    if (k) k.until = Math.max(k.until, this.clock + seconds);
  }

  /** Does the next job; returns how long it keeps the queue (s). */
  private run(job: Job, late: number): number {
    const speed = Math.min(this.tempo, 4);
    switch (job.kind) {
      case 'strike': {
        const { ch, at } = job;
        this.aim(at.col, at.line);
        this.idleFor = 0;
        this.lastStrike = this.clock;
        const space = ch === ' ';
        const info = space ? { id: 'space', mod: 0 } : this.barFor(ch);
        // Shift and Alt Gr: the basket drops before the bar can go.
        const level = info.mod;
        const wait = level !== this.segLevel ? 0.04 : 0;
        if (level && level !== this.segLevel) this.sound('shift', 0.7);
        this.segLevel = level;
        if (level) {
          for (const id of level === 1 ? [this.shiftFor(info.id)] : ['shiftL', 'shiftR'])
            this.pressKey(id, wait + 0.12 / speed);
        }
        const key = this.keys.get(info.id);
        if (key) key.until = this.clock - late + wait + 0.09 / speed;
        this.keySound(info.id, 0.55 / Math.sqrt(speed));
        if (space) this.step(at);
        else {
          const bar = this.bars.get(info.id)!;
          if (bar.state === 1) this.land(bar.ch, bar.at, bar);
          bar.ink = job.ink;
          bar.state = 1;
          bar.t = -wait + late;
          bar.dur = 0.07 / speed;
          // The tips land short when the basket is down: swing a touch further.
          bar.peak =
            this.geo.strike + [0, this.geo.shiftDrop, this.geo.altDrop][level] / BAR_LENGTH;
          bar.ch = ch;
          bar.at = at;
          this.inflight++;
        }
        this.guideUntil = this.clock + wait + 0.1 / speed;
        return JOB_GAP * (0.85 + Math.random() * 0.3) + wait;
      }
      case 'erase': {
        const travel = this.aim(job.at.col, job.at.line);
        this.idleFor = 0;
        this.pressKey('back', 0.15);
        this.keySound('back');
        if (this.tapeRun) this.finishTape();
        this.tapeRun = { t: -travel, dur: 0.3, at: job.at, cleared: false };
        return travel + 0.3;
      }
      case 'move': {
        const dc = job.at.col - this.tCol;
        const travel = this.aim(job.at.col, job.at.line);
        if (Math.abs(dc) === 1 && !travel) {
          this.pressKey(dc > 0 ? 'space' : 'back', 0.1);
          this.keySound(dc > 0 ? 'space' : 'back', 0.45);
        }
        this.idleFor = 0;
        return Math.max(travel, 0.05);
      }
      case 'put': {
        const { at, ch } = job;
        // Whatever is still on its way to the spot lands first.
        for (const b of this.bars.values()) {
          if (b.state === 1 && b.at.line === at.line && b.at.col === at.col) this.impact(b);
        }
        if (this.tapeRun?.at.line === at.line && this.tapeRun.at.col === at.col) this.finishTape();
        this.paper.clear(at, false);
        if (ch !== null) this.paper.text(at, ch, job.ink);
        return 0;
      }
      case 'ding':
        this.ring();
        return 0.25;
      case 'send':
        this.tear(job.done);
        return 0;
    }
  }

  private shiftFor(id: string) {
    return (this.keys.get(id)?.x ?? 0) < 0 ? 'shiftR' : 'shiftL';
  }

  /** A typebar hits the paper: the character lands, the spools tick, the carriage steps. */
  /** Impact: the glyph lands, and the bar bounces back off the paper. */
  private impact(b: Bar) {
    this.sound('clack', 0.95 / Math.sqrt(Math.min(this.tempo, 4)));
    this.land(b.ch, b.at, b);
    b.state = 2;
    b.spring.snap(b.peak * 1.03);
    b.spring.kick(-b.peak * 7);
  }

  private land(ch: string, at: Spot, bar?: Bar) {
    this.paper.print(ch, at, bar?.ink);
    if (bar) this.inflight--;
    this.spoolAngle += 0.35;
    this.needleS.kick(-0.4);
    if (at.col === BELL_COLUMN) this.ring();
    this.step(at);
  }

  private ring() {
    this.bellT = 0;
    this.sound('bell', 0.55, 0.7);
  }

  /** The carriage steps on one column, if nothing else has sent it elsewhere since. */
  private step(at: Spot) {
    if (this.tLine === at.line && this.tCol === at.col) {
      this.tCol = Math.min(at.col + 1, TYPE.columns);
      this.sound('tick', 0.4, 0.3);
    }
  }

  private finishTape() {
    const t = this.tapeRun;
    if (t && !t.cleared) this.paper.clear(t.at);
    this.tapeRun = null;
  }

  /** The sheet is torn off at the top of the roll and flies away; a fresh one feeds in. */
  private tear(done: () => void) {
    this.sending = { t: 0, phase: 0, done };
    // A few lines of feed first, as the paper is pulled up and out.
    this.bailS.kick(6);
  }

  private spawnFlyer() {
    if (!this.geometry || !this.front) return;
    this.sound('tear', 0.9);
    const texture = this.paper.snapshot();
    // What is out in the air above the bail is torn off; the rest stays in the machine.
    const geometry = this.geometry.clone();
    geometry.boundingSphere = this.geometry.boundingSphere;
    this.lay(geometry, this.feed.y, this.route.exitAt);
    const front = new MeshStandardMaterial({
      map: texture,
      color: PAPER_TINT,
      roughness: 0.95,
      alphaTest: 0.85,
      transparent: true,
    });
    const back = new MeshStandardMaterial({
      color: '#e7e7e3',
      roughness: 0.95,
      side: BackSide,
      transparent: true,
    });
    const meshes = [new Mesh(geometry, front), new Mesh(geometry, back)];
    const holder = new Group();
    const inner = new Group();
    inner.matrixAutoUpdate = false;
    this.group.updateMatrixWorld(true);
    inner.matrix.copy(this.sheet.matrixWorld).premultiply(this.group.matrixWorld.clone().invert());
    meshes.forEach((m) => {
      m.frustumCulled = false;
      inner.add(m);
    });
    holder.add(inner);
    this.group.add(holder);
    this.flyer = {
      holder,
      meshes,
      texture,
      t: 0,
      x: new Spring(1.3, 0.8, 0),
      y: new Spring(1.5, 0.75, -0.6),
      tilt: new Spring(1.5, 0.6, 0),
    };
  }

  private dropFlyer() {
    const f = this.flyer;
    if (!f) return;
    f.holder.removeFromParent();
    f.meshes[0].geometry.dispose();
    f.meshes.forEach((m) => (m.material as MeshStandardMaterial).dispose());
    f.texture.dispose();
    this.flyer = null;
  }

  // ---- Every frame --------------------------------------------------------------------

  /** A frame: the physics in fixed steps of STEP (so it moves the same at 20 fps as at
   * 120), then the sheet, the paper's picture and the face drawn once. */
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
    this.idleFor += dt;
    const now = this.clock;

    // The queue: the tempo rises with the backlog, so nothing falls far behind.
    const backlog = this.jobs.length - this.head;
    const want = Math.min(80, Math.max(1, (backlog * JOB_GAP) / MAX_LAG));
    // It speeds up at once when the backlog grows, holds that until the queue is empty, and
    // then eases back.
    if (want > this.tempo) this.tempo = want;
    else if (!backlog)
      this.tempo = Math.max(1, this.tempo + (1 - this.tempo) * Math.min(1, dt * 4));
    if (!this.sending) {
      this.next = Math.max(this.next, now - dt);
      let guard = 400;
      while (this.head < this.jobs.length && this.next <= now && guard-- > 0) {
        const job = this.jobs[this.head++];
        const late = now - this.next;
        const hold = this.run(job, late);
        this.next += hold / this.tempo;
        if (this.sending) break;
      }
      if (this.head >= this.jobs.length && this.head > 0) {
        this.jobs.length = 0;
        this.head = 0;
      }
    }
    this.sendStep(dt);

    // With nothing to do the carriage and the platen settle at the caret.
    if (!this.busy && this.caretAt && this.idleFor > 0.15) {
      if (this.tCol !== this.caretAt.col || this.tLine !== this.caretAt.line)
        this.aim(this.caretAt.col, this.caretAt.line);
      this.idleFor = 0.15;
    }
    if (this.segLevel && now - this.lastStrike > 0.3 && this.head >= this.jobs.length)
      this.segLevel = 0;

    // The carriage and the platen go where they are sent, and the springs give them their
    // weight.
    this.carriageStep(dt);
    const line = this.rLine;
    this.rLine += clampStep(this.tLine - this.rLine, this.feedRate * dt);
    // The platen's ratchet clicks over at every line.
    if (Math.floor(line + 0.5) !== Math.floor(this.rLine + 0.5)) this.sound('ratchet', 0.5, -0.6);
    const cx = this.calm(this.carX, this.carCalm, dt, this.xOf(this.rCol));
    const fd = this.calm(this.feed, this.feedCalm, dt, this.rLine + this.pull());
    this.carriage?.set(cx);
    this.sheet.position.x = cx;
    this.platen?.set((fd * TYPE.line) / this.geo.platenRadius);
    this.roll?.set((fd * TYPE.line) / this.geo.rollRadius);

    this.bars_(dt);
    this.keys_(dt);
    this.parts(dt);
    this.tapeStep(dt);
    this.flyStep(dt);
    this.gazeStep(dt);
  }

  /** The carriage: let on a column at a time by the escapement, or on a run, gathering speed
   * (the rack's teeth buzzing past the pawl) until it hits the stop and bounces. */
  private carriageStep(dt: number) {
    const run = this.carRun;
    if (!run) {
      this.rCol += clampStep(this.tCol - this.rCol, ESCAPE * dt);
      return;
    }
    if (run.wait > 0) {
      run.wait -= dt;
      return;
    }
    const dir = Math.sign(this.tCol - this.rCol);
    const from = this.rCol;
    this.vCol = Math.max(-RUN_MAX, Math.min(RUN_MAX, this.vCol + dir * RUN_ACCEL * dt));
    this.rCol += this.vCol * dt;
    if (Math.floor(from) !== Math.floor(this.rCol)) this.sound('zip', 0.3, 0.3);
    if (!dir || (this.tCol - this.rCol) * dir <= 0) {
      const hit = Math.min(1, Math.abs(this.vCol) / RUN_MAX);
      this.rCol = this.tCol;
      this.vCol = 0;
      this.carRun = null;
      if (hit > 0.05) {
        this.sound('thunk', 0.35 + 0.65 * hit, dir > 0 ? -0.5 : 0.5);
        if (!this.reducedMotion) this.bobS.kick(-0.4 * hit);
      }
    }
  }

  /** Lines of feed the sheet is pulled up by just before it is torn off. */
  private pull() {
    const s = this.sending;
    return s && s.phase === 0 && !this.reducedMotion ? 4 * Math.min(1, s.t / 0.3) : 0;
  }

  /** A spring that chases its target; with motion reduced a brisk one with no overshoot
   * does it instead (both are kept up to date, so switching mid-move is smooth). */
  private calm(lively: Spring, brisk: Spring, dt: number, target: number) {
    const a = lively.update(dt, target);
    const b = brisk.update(dt, target);
    return this.reducedMotion ? b : a;
  }

  private spring(s: Spring, dt: number, target: number) {
    return s.update(dt, target);
  }

  private bars_(dt: number) {
    for (const b of this.bars.values()) {
      if (!b.state) continue;
      if (b.state === 1) {
        b.t += dt;
        if (b.t < 0) continue;
        const u = Math.min(1, b.t / b.dur);
        b.hinge?.set(b.peak * Math.pow(u, 1.7));
        if (u >= 1) this.impact(b);
      } else {
        let a = b.spring.update(dt, 0);
        if (a < 0) {
          a = 0;
          b.spring.snap(0);
        }
        b.hinge?.set(a);
        if (a < 0.002 && Math.abs(b.spring.v) < 0.05) {
          b.hinge?.set(0);
          b.state = 0;
        }
      }
    }
  }

  private keys_(dt: number) {
    const press = this.geo.keyPress;
    for (const [id, k] of this.keys) {
      if (!k.hinge) continue;
      const down = this.clock < k.until || this.held.has(id);
      if (!down && Math.abs(k.spring.y) < 1e-4 && Math.abs(k.spring.v) < 1e-3) {
        if (k.spring.y) {
          k.spring.snap(0);
          k.hinge.set(0);
        }
        continue;
      }
      k.hinge.set(k.spring.update(dt, down ? press : 0));
    }
  }

  /** The basket, guide, spools, lever, bail, bell, gauge and the body on its feet. */
  private parts(dt: number) {
    const g = this.geo;
    const t = this.clock;
    const still = this.reducedMotion;
    const drop = [0, g.shiftDrop, g.altDrop][this.segLevel];
    this.segment?.set(-this.spring(this.seg, dt, drop));
    this.guide?.set(this.spring(this.guideS, dt, t < this.guideUntil ? (g.guideLift ?? 0.17) : 0));
    const spin = this.spring(this.spool, dt, this.spoolAngle);
    this.spools.forEach((s, i) => s.set(i ? spin : -spin));
    this.lever?.set(this.spring(this.leverS, dt, t < this.leverUntil ? (g.leverThrow ?? 0.9) : 0));
    this.bail?.set(this.spring(this.bailS, dt, BAIL_UP) * (g.bailLift ?? 0.35));
    const bob = still ? 0 : this.bobS.update(dt, 0);
    this.body?.set(bob * 0.012);
    this.bodyTilt?.set(bob * 0.02);
    // The bell: a clapper rattling against the dome, dying away.
    let ring = 0;
    if (this.bellT >= 0) {
      this.bellT += dt;
      ring = Math.sin(this.bellT * 90) * Math.exp(-this.bellT * 7) * 0.5;
      if (this.bellT > 1.2) this.bellT = -1;
    } else this.bellT = -1;
    this.bell?.set(ring * (g.bellSwing ?? 0.5) * 2);
    // The gauge breathes a little, and jumps back when a bar strikes.
    const [lo, hi] = g.needleRange ?? [-0.9, 0.9];
    const breath = still ? 0 : wobble(t * 0.35, 4) * 0.1;
    const level = 0.62 + breath + this.spring(this.needleS, dt, 0) * 0.25;
    this.needle?.set(lo + (hi - lo) * level);
    // The flag: raised or lowered with a bounce, and stirring a little while it's up.
    const flutter = this.flagUp && !still ? wobble(t * 1.7, 9) * 0.03 : 0;
    this.flagHinge?.set(this.spring(this.flagS, dt, this.flagUp ? 0 : -FLAG_DOWN) + flutter);
    this.flagPlate?.set(this.spring(this.plateS, dt, this.flagUp ? 0 : PLATE_TURN));
    const o = this.outfit;
    if (o) {
      const busy = t - this.lastStrike < 0.5;
      o.dot(0, busy ? 1 : 0.55 + (still ? 0 : 0.15 * Math.sin(t * 1.1)));
      o.dot(1, this.bellT >= 0 ? 1 : 0.2 + (still ? 0 : 0.06 * Math.sin(t * 1.3)));
      o.dot(2, busy ? 1 : 0.4);
      o.dot(3, 0.8);
      o.dot(4, 0.6 + (still ? 0 : 0.1 * Math.sin(t * 0.8)));
    }
  }

  private tapeStep(dt: number) {
    const r = this.tapeRun;
    const lift = this.geo.tapeLift ?? 0.87;
    const up = r ? (r.t < 0 ? 0 : Math.sin(Math.min(1, r.t / r.dur) * Math.PI)) : 0;
    this.tape?.set(this.tapeS.update(dt, up > 0.12 ? lift : 0));
    if (!r) return;
    r.t += dt * Math.min(this.tempo, 4);
    if (!r.cleared && r.t >= r.dur * 0.4) {
      r.cleared = true;
      this.sound('tape', 0.6);
      this.paper.clear(r.at);
    }
    if (r.t >= r.dur) this.tapeRun = null;
  }

  /** The sheet's end: fed out, torn off, flown away, a fresh one fed in. */
  private sendStep(dt: number) {
    const s = this.sending;
    if (!s) return;
    s.t += dt;
    if (this.reducedMotion) {
      // A fade: the old sheet out, the new one in.
      if (s.phase === 0) {
        this.spawnFlyer();
        this.renew();
        s.phase = 1;
        s.t = 0;
      } else if (s.t > 0.35) {
        this.finishSend();
      }
      return;
    }
    if (s.phase === 0 && s.t > 0.3) {
      // Torn off: the old sheet flies, the new one is fed from the roll.
      this.spawnFlyer();
      this.renew();
      s.phase = 1;
      s.t = 0;
      this.leverUntil = this.clock + 0.4;
    } else if (s.phase === 1 && s.t > 1.05) {
      this.finishSend();
    }
  }

  private renew() {
    this.paper.clearAll();
    this.fade = this.reducedMotion ? 0 : 1;
    this.feed.snap(this.reducedMotion ? 0 : this.startFeed());
    this.feedCalm.snap(this.reducedMotion ? 0 : this.startFeed());
    this.rLine = this.reducedMotion ? 0 : this.startFeed();
    this.tLine = 0;
    this.tCol = 0;
    this.rCol = this.reducedMotion ? 0 : this.rCol;
    this.feedRate = 22;
    this.carRun = this.reducedMotion ? null : { wait: 0.1 };
    this.vCol = 0;
    this.segLevel = 0;
    this.fed = NaN;
  }

  private finishSend() {
    const s = this.sending!;
    this.sending = null;
    this.next = this.clock;
    this.dropFlyer();
    this.frontMat.opacity = 1;
    this.frontMat.transparent = false;
    s.done();
  }

  private flyStep(dt: number) {
    const f = this.flyer;
    if (f) {
      f.t += dt;
      const k = this.reducedMotion ? 0 : 1;
      const x = f.x.update(dt, k * 0.35);
      const y = f.y.update(dt, k * 0.8);
      const tilt = f.tilt.update(dt, k * 0.5);
      f.holder.position.set(x, y, 0.1 * k * Math.min(1, f.t));
      f.holder.rotation.set(-0.3 * k * Math.min(1, f.t), 0, -tilt);
      const a = Math.max(
        0,
        1 - (f.t - (this.reducedMotion ? 0 : 0.35)) / (this.reducedMotion ? 0.3 : 0.6),
      );
      for (const m of f.meshes) (m.material as MeshStandardMaterial).opacity = Math.min(1, a);
    }
    // The fresh sheet comes up as the old one goes (reduced motion only fades it in).
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / (this.reducedMotion ? 0.3 : 0.25));
      this.frontMat.transparent = this.fade < 1;
      this.frontMat.opacity = this.fade;
      this.frontMat.needsUpdate = true;
    }
  }

  /** The gaze's springs, in the fixed steps. */
  private gazeStep(dt: number) {
    this.face.look.x = this.gazeX.update(dt, this.gaze.x);
    this.face.look.y = this.gazeY.update(dt, this.gaze.y);
  }

  /** The face's expression and where it looks, worked out once a frame. */
  private faceStep() {
    const f = this.face;
    const typing = this.clock - this.lastStrike < 0.8 || this.inflight > 0;
    const m = this.moodNow;
    f.mark = m === 'puzzled' ? 'question' : 'none';
    f.expression =
      m === 'asleep'
        ? 'asleep'
        : m === 'happy'
          ? 'happy'
          : m === 'typing' || (m === 'idle' && typing)
            ? 'focused'
            : 'neutral';
    // Where the eyes go: at the print point while typing, else at the pointer, else the caret.
    let gx = 0;
    let gy = 0;
    const cam = this.camera;
    if (cam && m !== 'asleep') {
      const p = this.ndcTmp;
      const want =
        typing || m === 'typing' ? 'print' : this.pointer ? 'pointer' : this.caretAt ? 'caret' : '';
      let tx = 0;
      let ty = 0;
      if (want === 'pointer') [tx, ty] = [this.pointer!.x, this.pointer!.y];
      else if (want) {
        if (want === 'print') p.copy(this.printPoint);
        else this.spotPoint(this.caretAt!, p.set(0, 0, 0));
        if (want === 'print') this.group.localToWorld(p);
        p.project(cam);
        [tx, ty] = [p.x, p.y];
      }
      if (want) {
        const c = this.tmp.copy(this.faceAt);
        this.group.localToWorld(c).project(cam);
        gx = Math.max(-1, Math.min(1, (tx - c.x) * 2.2));
        gy = Math.max(-1, Math.min(1, -(ty - c.y) * 2.2));
      }
    }
    this.gaze.x = gx;
    this.gaze.y = gy;
    f.update(this.reducedMotion ? 0 : this.clock);
  }

  dispose() {
    this.dropFlyer();
    this.group.removeFromParent();
    this.outfit?.dispose();
    this.face.dispose();
    this.paper.dispose();
    this.geometry?.dispose();
    this.frontMat.dispose();
    this.backMat.dispose();
    this.legendMat?.dispose();
    this.rollMat?.dispose();
    this.flagMat?.dispose();
    this.flagTex?.dispose();
    this.ribbonMat?.dispose();
    this.legend?.dispose();
  }
}

/** A move of at most `max` toward a gap. */
function clampStep(gap: number, max: number) {
  return Math.max(-max, Math.min(max, gap));
}

// ---- Putting it on a canvas --------------------------------------------------------------

const FOV = 18;
/** The narrowest a character may be on screen (px) before the camera closes in on the sheet. */
const MIN_PX = 9;
/** Camera height over depth (tan of the elevation) on a wide canvas and on a narrow one. */
const WIDE_TILT = 0.75;
const NARROW_TILT = 0.4;

/** The machine on a canvas of its own: renderer, lights as on the crew's stage, and a camera
 * that frames the whole machine and its sheet on a wide canvas, and follows the paper closely
 * on a narrow one. */
export function mountTypewriter(canvas: HTMLCanvasElement, opts: TypewriterOptions) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-0.55, 0.75, 1);
  const rim = new DirectionalLight(0xffffff, 1.4);
  rim.position.set(0.5, 0.6, -1);
  scene.add(new HemisphereLight(0xffffff, 0x9a9a94, 1.9), key, rim);
  const typewriter = new Typewriter(opts);
  scene.add(typewriter.group);
  const sounds = new Sounds();
  sounds.volume = opts.volume ?? 0.7;
  typewriter.onSound = (e) => sounds.play(e);
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 40);
  typewriter.camera = camera;

  // The camera's goal: a point to look at and how far back to stand.
  const aim = new Vector3();
  const goal = new Vector3();
  const here = new Vector3();
  const dir = new Vector3();
  const corner = new Vector3();
  const box = new Box3();
  const right = new Vector3();
  const upc = new Vector3();
  let dist = 3;
  let follow = false;
  let ready = false;
  let width = 1;
  let height = 1;

  /** How far back (along `dir`) the box fits the view, looking at its middle. */
  const fit = (b: Box3, centre: Vector3) => {
    const tanY = Math.tan((FOV / 2) * (Math.PI / 180));
    const tanX = tanY * camera.aspect;
    right.crossVectors(dir.clone().negate(), camera.up).normalize();
    upc.crossVectors(right, dir.clone().negate());
    let d = 0;
    for (let i = 0; i < 8; i++) {
      corner
        .set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
        .sub(centre);
      d = Math.max(
        d,
        corner.dot(dir) +
          Math.max(Math.abs(corner.dot(right)) / tanX, Math.abs(corner.dot(upc)) / tanY),
      );
    }
    return d;
  };

  const frame = () => {
    if (!ready) return;
    const tanY = Math.tan((FOV / 2) * (Math.PI / 180));
    const wideFrame = () => {
      // The whole machine, feet to the top of the sheet, seen from above and in front the way
      // a typist sees it: the print line is clear of the platen and the lines above it read.
      box.copy(typewriter.bounds);
      box.getCenter(aim);
      dist = 0;
      dir.set(0.06, WIDE_TILT, 1).normalize();
      dist = fit(box, aim);
    };
    wideFrame();
    // Pixels across one character: the paper has to stay readable. Too small, and the
    // camera closes in on the paper just enough, turning down to it as it comes; on a narrow
    // canvas it comes all the way, the paper filling the width, and follows the carriage.
    const wide = dist;
    const px = (height / (2 * wide * tanY)) * TYPE.pitch;
    follow = false;
    if (px < MIN_PX) {
      const p = typewriter.printPoint;
      const w = (TYPE.columns + 2) * TYPE.pitch * 1.04;
      const cx = typewriter.x0 + (MARGIN + TYPE.columns / 2) * TYPE.pitch;
      dir.set(0, NARROW_TILT, 1).normalize();
      box.min.set(cx - w / 2, p.y - 0.01, p.z - 0.01);
      box.max.set(cx + w / 2, p.y + 0.01, p.z + 0.01);
      const paper = fit(box, corner.set(cx, p.y, p.z));
      const need = (height * TYPE.pitch) / (2 * tanY * MIN_PX);
      dist = Math.max(need, paper);
      // How far in it has come: 0 the whole machine, 1 the paper alone.
      const k = Math.min(1, Math.max(0, (wide - dist) / Math.max(1e-6, wide - paper)));
      dir.set(0.06 * (1 - k), WIDE_TILT + (NARROW_TILT - WIDE_TILT) * k, 1).normalize();
      const machine = typewriter.bounds.getCenter(corner);
      const visible = 2 * dist * tanY;
      aim.set(
        machine.x + (cx - machine.x) * k,
        machine.y + (p.y + visible * 0.16 - machine.y) * Math.min(1, k * 1.6),
        machine.z + (p.z - machine.z) * Math.min(1, k * 1.6),
      );
      follow = k > 0.5;
    }
    camera.near = dist * 0.05;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
  };

  const resize = () => {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    outlineUniforms.viewport.value.set(width * dpr, height * dpr);
    outlineUniforms.outlinePx.value = 1.1 * dpr;
    frame();
    if (ready) snap();
  };

  const place = (k: number) => {
    goal.copy(aim);
    if (follow) goal.x += typewriter.carriageX;
    here.lerp(goal, k);
    camera.position.copy(here).addScaledVector(dir, dist);
    camera.lookAt(here);
  };
  const snap = () => place(1);

  typewriter.ready.then(() => {
    ready = true;
    frame();
    snap();
  });

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  const loop = (time: number) => {
    raf = 0;
    if (!running) return;
    const dt = last ? (time - last) / 1000 : 0.016;
    last = time;
    typewriter.update(dt);
    // The narrow camera stays on the sheet, which rides the carriage: follow it smoothly.
    if (ready) {
      place(typewriter.reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    const should = running && visible && !document.hidden;
    if (should && !raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    } else if (!should && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    wake();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', wake);

  return {
    typewriter,
    camera,
    renderer,
    sounds,
    /** A pointer event's position as NDC on this canvas. */
    ndc(e: { clientX: number; clientY: number }) {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -(((e.clientY - r.top) / r.height) * 2 - 1),
      };
    },
    start() {
      running = true;
      wake();
    },
    stop() {
      running = false;
      wake();
    },
    dispose() {
      running = false;
      wake();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', wake);
      typewriter.dispose();
      sounds.dispose();
      renderer.dispose();
    },
  };
}
