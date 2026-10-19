import { Group, PerspectiveCamera, Scene } from 'three';
import type { PlayFrame } from '../core/playFrame';

export interface SceneRig {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Herný priestor: všetko, čo je ukotvené k vycentrovanej ploche. */
  playRoot: Group;
}

export function createScene(): SceneRig {
  const scene = new Scene();
  scene.background = null;

  const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 60);
  camera.position.set(0, 1.6, 0);
  scene.add(camera);

  const playRoot = new Group();
  playRoot.name = 'playRoot';
  scene.add(playRoot);

  // Bez svetiel: všetky materiály sú unlit (holo materiál má vlastné tieňovanie a okraj, materials.ts).

  return { scene, camera, playRoot };
}

/** Prenesie transformáciu herného priestoru na skupinu playRoot. */
export function applyPlayFrame(playRoot: Group, frame: PlayFrame): void {
  playRoot.position.set(frame.originX, 0, frame.originZ);
  playRoot.rotation.set(0, frame.yaw, 0);
}
