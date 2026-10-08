import {
  BackSide,
  Color,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  SkinnedMesh,
  type Texture,
  Vector2,
} from 'three';
import PALETTES from './palettes.json';

/**
 * The typewriter's looks, matching LOOKS in blender/looks.py. The model carries no
 * materials of its own, only names that say what each part is (Shell, Joint, Bezel, Glow,
 * Beacon, Screen, Dot.n); dress() builds the look's materials for those parts. A part with
 * a colour of its own in the colour look is named Base_Role (Shell_Cap): the other looks
 * draw it as its base.
 */
export const LOOKS = {
  // An ink machine, with a paper-white face.
  ink: {
    shell: '#1c1c1b',
    joint: '#55554f',
    visor: '#060606',
    bezel: '#55554f',
    glow: '#f4f4f1',
    outline: null,
  },
  // A paper machine drawn in ink.
  paper: {
    shell: '#f4f4f1',
    joint: '#55554f',
    visor: '#111111',
    bezel: '#111111',
    glow: '#f4f4f1',
    outline: '#111111',
  },
  // Its own colours (palettes.json, shared with the Blender previews).
  colour: {
    shell: '#f4f4f1',
    joint: '#55554f',
    visor: '#111111',
    bezel: '#55554f',
    glow: '#f4f4f1',
    outline: null,
  },
} as const;
type Tone = 'shell' | 'joint' | 'visor' | 'bezel' | 'glow';
/** A character's colours in the colour look: over the look's base, for parts with a
 * role of their own, and a blinking dot's colours, off then on. */
interface Palette {
  base?: Partial<Record<Tone, string>>;
  roles?: Record<string, string>;
  dots?: string[];
}
const PALETTE = PALETTES as unknown as Record<string, Palette>;
export type LookName = keyof typeof LOOKS;
const INK = '#111111';
const tint = new Color();
/** The one colour every light is in, when it isn't the look's own paper-white (dress again
 * to see a change). */
export const glowColour: { value: string | null } = { value: null };

/** Flames glow paper-white, or take the beacon's colour. */
export type FlameStyle = 'glow' | 'beacon';

/** Shared by every outline: its width in device pixels and the drawing buffer size. */
export const outlineUniforms = {
  outlinePx: { value: 1.5 },
  viewport: { value: new Vector2(1, 1) },
};

export interface Outfit {
  /** Every material this outfit made, outlines included (for clipping planes). */
  materials: Material[];
  /** Recolour the beacon (and beacon-coloured flames). */
  beacon(colour: string | Color): void;
  /** Brightness of a glowing dot, 0 (dark) to 1, lit in its own colour or the one given. */
  dot(index: number, level: number, colour?: string | Color): void;
  dispose(): void;
}

export function dress(
  root: Object3D,
  look: LookName,
  opts: { screen?: Texture; flame?: FlameStyle; beacon?: string; model?: string } = {},
): Outfit {
  const palette: Palette = look === 'colour' ? (PALETTE[opts.model ?? ''] ?? {}) : {};
  const c = {
    ...LOOKS[look],
    ...palette.base,
    ...(glowColour.value && { glow: glowColour.value }),
  };
  const beaconColour = new Color(opts.beacon ?? c.glow);
  const glow = new Color(c.glow);
  const standard = (colour: string, roughness = 0.6) =>
    new MeshStandardMaterial({ color: colour, roughness, metalness: 0 });
  const made: Material[] = [];
  const shared: Record<string, Material> = {
    Shell: standard(c.shell),
    Joint: standard(c.joint, 0.55),
    Bezel: standard(c.bezel, 0.55),
    Glow: new MeshBasicMaterial({ color: glow }),
    Beacon: new MeshBasicMaterial({ color: beaconColour }),
    // Glossy enough to read as glass, rough enough that a highlight never hides the face.
    Screen: new MeshStandardMaterial({
      color: c.visor,
      roughness: 0.45,
      emissive: opts.screen ? 0xffffff : 0x000000,
      emissiveMap: opts.screen ?? null,
    }),
  };
  shared.VisorFace = shared.Screen;
  shared.Flame = opts.flame === 'beacon' ? shared.Beacon : new MeshBasicMaterial({ color: glow });
  for (const [role, colour] of Object.entries(palette.roles ?? {}))
    shared[`_${role}`] = standard(colour);
  made.push(...new Set(Object.values(shared)));
  const dots: MeshBasicMaterial[] = [];
  const lit = new Color(palette.dots?.[1] ?? c.glow);
  const dim = palette.dots
    ? new Color(palette.dots[0])
    : new Color(c.shell).lerp(new Color(c.joint), 0.5);

  // Dressing again (a new look) replaces the last outfit's outlines.
  const meshes: Mesh[] = [];
  const stale: Object3D[] = [];
  root.traverse((obj) => {
    if (obj.userData.outline) stale.push(obj);
    else if ((obj as Mesh).isMesh) meshes.push(obj as Mesh);
  });
  stale.forEach((obj) => obj.removeFromParent());
  for (const mesh of meshes) {
    const name: string = (mesh.userData.role ??= (mesh.material as Material).name);
    mesh.frustumCulled = false; // skinned bounds are the rest pose's
    const dot = /^Dot\.?(\d+)/.exec(name);
    if (dot) {
      const m = new MeshBasicMaterial({ color: lit });
      dots[Number(dot[1])] = m;
      made.push(m);
      mesh.material = m;
    } else {
      const [base, role] = name.replace(/\.\d+$/, '').split('_');
      mesh.material =
        (role && shared[`_${role}`]) || shared[base] || shared.Shell;
    }
    // Glowing parts that stand out against the page (flames, the beacon) are paper-white,
    // so on the ink look they get the ink line the paper look has everywhere.
    const line = c.outline ?? (/^(Flame|Beacon)/.test(name) ? INK : null);
    if (line) addOutline(mesh, line, made);
  }

  return {
    materials: made,
    beacon(colour) {
      beaconColour.set(colour);
      (shared.Beacon as MeshBasicMaterial).color.copy(beaconColour);
    },
    dot(index, level, colour) {
      dots[index]?.color.copy(dim).lerp(colour ? tint.set(colour) : lit, level);
    },
    dispose() {
      made.forEach((m) => m.dispose());
    },
  };
}

/**
 * An ink line round a part, by the inverted-hull trick used in the Blender previews: the
 * part drawn again, back faces only, each vertex pushed out along its normal on screen by
 * a fixed number of pixels, so the line stays the same weight at any size.
 */
function addOutline(mesh: Mesh, colour: string, made: Material[]) {
  const material = new MeshBasicMaterial({ color: colour, side: BackSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, outlineUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float outlinePx;\nuniform vec2 viewport;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #if defined( USE_ENVMAP ) || defined( USE_SKINNING )
          vec3 outlineNormal = objectNormal;
        #else
          vec3 outlineNormal = normal;
        #endif
        vec2 outlineDir = (projectionMatrix * vec4(normalize(normalMatrix * outlineNormal), 0.0)).xy;
        gl_Position.xy += normalize(outlineDir + 1e-6) * outlinePx * 2.0 / viewport * gl_Position.w;`,
      );
  };
  material.customProgramCacheKey = () => 'robot-outline';
  made.push(material);
  let hull: Mesh;
  if ((mesh as SkinnedMesh).isSkinnedMesh) {
    const skinned = mesh as SkinnedMesh;
    const s = new SkinnedMesh(skinned.geometry, material);
    s.bind(skinned.skeleton, skinned.bindMatrix);
    hull = s;
  } else {
    hull = mesh.clone();
    hull.material = material;
  }
  hull.userData.outline = true;
  hull.position.copy(mesh.position);
  hull.quaternion.copy(mesh.quaternion);
  hull.scale.copy(mesh.scale);
  hull.frustumCulled = false;
  mesh.parent?.add(hull);
}
