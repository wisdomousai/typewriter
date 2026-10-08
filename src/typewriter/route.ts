/** Where a machine's paper runs, in its side view: the measurements the path is laid by
 * (metres; [y, z] pairs in the model's frame, Z up, the machine facing -Y). */
export interface PathGeometry {
  print: number[];
  platenAxis: number[];
  platenRadius: number;
  /** Where the paper leaves the machine (the typewriter's bail, the teleprinter's tear bar). */
  bail: number[];
  /** How far from upright the paper runs on past it, leaning back (rad). */
  exitAngle: number;
  roll: number[];
  rollRadius: number;
  table: number[];
  tableTop?: number[];
}

export interface RouteOptions {
  /** A line's height on the paper (m). */
  line: number;
  /** Lines of free paper above the print point before it curls back over the machine, the
   * curl's bend (rad per m), and how far on the path runs past its start (m). */
  curlLines: number;
  curlBend: number;
  curlRun: number;
}

/**
 * The paper's path in the machine's side view, from the roll to well above the bail, as
 * a dense polyline (u toward the typist, v up, metres). It runs from the roll up to the
 * table, down the back of the platen, under it and up its front past the print point,
 * through the bail and out at the exit angle; far enough up it curls back over the machine.
 */
export class Route {
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

  constructor(g: PathGeometry, opts: RouteOptions) {
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
    const curlFrom = this.printAt + opts.curlLines * opts.line;
    let u = pts[pts.length - 2];
    let v = pts[pts.length - 1];
    const start = (pts.length / 2 - 1) * this.ds;
    this.exitAt = start;
    for (let s = start; s < curlFrom + opts.curlRun; s += this.ds) {
      const k = Math.min(1, (s - start) / 0.08);
      const h = into + turn * k * k * (3 - 2 * k) + Math.max(0, s - curlFrom) * opts.curlBend;
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
