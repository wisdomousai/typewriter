import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

/** The models are meshopt-compressed (blender/build.sh); each is loaded once and cloned. */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = new Map<string, Promise<Object3D>>();

export function loadModel(url: string): Promise<Object3D> {
  let scene = models.get(url);
  if (!scene) models.set(url, (scene = loader.loadAsync(url).then((gltf) => gltf.scene)));
  return scene.then((s) => clone(s));
}
