import {
  Box3,
  type Camera,
  DirectionalLight,
  type Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { outlineUniforms } from './looks';
import { type SoundEvent, Sounds } from './sound';

/** What the stage needs of a machine (the typewriter, the teleprinter). */
export interface Machine {
  readonly group: Group;
  readonly ready: Promise<void>;
  /** The whole machine (and its paper as far as the camera should keep) in the group's space. */
  readonly bounds: Box3;
  /** The print point in the group's space. */
  readonly printPoint: Vector3;
  /** The line being typed across the paper (x of its middle and its width, m, in the group's
   * space), and a character's width on it. */
  readonly lineSpan: { x: number; width: number };
  readonly pitch: number;
  /** How far the paper has slid along x from its rest (the typewriter's carriage; 0 for a
   * machine whose paper stays put): a close camera follows it. */
  readonly shift: number;
  reducedMotion: boolean;
  camera: Camera | null;
  onSound: ((e: SoundEvent) => void) | null;
  update(dt: number): void;
  dispose(): void;
}

export interface StageOptions {
  /** Its sounds' volume, 0 (silent) to 1. */
  volume?: number;
  /** Close in on the paper when the type would be too small to read (off: the whole machine,
   * however small the canvas). */
  closeUp?: boolean;
}

const FOV = 18;
/** The narrowest a character may be on screen (px) before the camera closes in on the paper. */
const MIN_PX = 9;
/** Camera height over depth (tan of the elevation) on a wide canvas and on a narrow one. */
const WIDE_TILT = 0.75;
const NARROW_TILT = 0.4;

/** A machine on a canvas of its own: renderer, lights as on the crew's stage, and a camera
 * that frames the whole machine and its paper, and (with `closeUp`) closes in on the line being
 * typed (following the paper, if it slides) when the type would be too small to read. */
export function mountStage(canvas: HTMLCanvasElement, machine: Machine, opts: StageOptions = {}) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-0.55, 0.75, 1);
  const rim = new DirectionalLight(0xffffff, 1.4);
  rim.position.set(0.5, 0.6, -1);
  scene.add(new HemisphereLight(0xffffff, 0x9a9a94, 1.9), key, rim);
  scene.add(machine.group);
  const sounds = new Sounds();
  sounds.volume = opts.volume ?? 0.7;
  machine.onSound = (e) => sounds.play(e);
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 40);
  machine.camera = camera;

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
    // The whole machine, feet to the top of the paper, seen from above and in front the way
    // a typist sees it: the print line is clear and the lines above it read.
    box.copy(machine.bounds);
    box.getCenter(aim);
    dir.set(0.06, WIDE_TILT, 1).normalize();
    dist = fit(box, aim);
    // Pixels across one character: the paper has to stay readable. Too small, and the
    // camera closes in on the paper just enough, turning down to it as it comes; on a narrow
    // canvas it comes all the way, the line filling the width, and follows the paper.
    const wide = dist;
    const px = (height / (2 * wide * tanY)) * machine.pitch;
    follow = false;
    if (opts.closeUp && px < MIN_PX) {
      const p = machine.printPoint;
      const { x: cx, width: w } = machine.lineSpan;
      dir.set(0, NARROW_TILT, 1).normalize();
      box.min.set(cx - w / 2, p.y - 0.01, p.z - 0.01);
      box.max.set(cx + w / 2, p.y + 0.01, p.z + 0.01);
      const paper = fit(box, corner.set(cx, p.y, p.z));
      const need = (height * machine.pitch) / (2 * tanY * MIN_PX);
      dist = Math.max(need, paper);
      // How far in it has come: 0 the whole machine, 1 the paper alone.
      const k = Math.min(1, Math.max(0, (wide - dist) / Math.max(1e-6, wide - paper)));
      dir.set(0.06 * (1 - k), WIDE_TILT + (NARROW_TILT - WIDE_TILT) * k, 1).normalize();
      const middle = machine.bounds.getCenter(corner);
      const visible = 2 * dist * tanY;
      aim.set(
        middle.x + (cx - middle.x) * k,
        middle.y + (p.y + visible * 0.16 - middle.y) * Math.min(1, k * 1.6),
        middle.z + (p.z - middle.z) * Math.min(1, k * 1.6),
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
    if (follow) goal.x += machine.shift;
    here.lerp(goal, k);
    camera.position.copy(here).addScaledVector(dir, dist);
    camera.lookAt(here);
  };
  const snap = () => place(1);

  machine.ready.then(() => {
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
    machine.update(dt);
    // The close camera stays on the paper, which may slide: follow it smoothly.
    if (ready) place(machine.reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
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
      machine.dispose();
      sounds.dispose();
      renderer.dispose();
    },
  };
}
