import { type Object3D, Quaternion, Vector3 } from 'three';

/** The joints the machines' bones are posed by: each turns about one axis or slides along one
 * direction from where it rests, so a pose is one number per bone. */

/** A bone that turns about one axis, from where it rests. `axis` is in the bone's frame. */
export class Hinge {
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
export class Slider {
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

/** A move of at most `max` toward a gap. */
export function clampStep(gap: number, max: number) {
  return Math.max(-max, Math.min(max, gap));
}
