import { DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene } from 'three';
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

  // Lacné osvetlenie bez tieňov: stačí na tvar low-poly prekážok.
  scene.add(new HemisphereLight(0xffffff, 0x3a4a5c, 2.2));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(1.5, 4, 2);
  scene.add(sun);

  return { scene, camera, playRoot };
}

/** Prenesie transformáciu herného priestoru na skupinu playRoot. */
export function applyPlayFrame(playRoot: Group, frame: PlayFrame): void {
  playRoot.position.set(frame.originX, 0, frame.originZ);
  playRoot.rotation.set(0, frame.yaw, 0);
}
