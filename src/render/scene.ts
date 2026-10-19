import { DirectionalLight, Group, HemisphereLight, PMREMGenerator, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

  // Osvetlenie bez tieňových máp: obloha/podlaha a „strop“ zhora spredu; odrazy dá prostredie (applyEnvironment).
  scene.add(new HemisphereLight(0xffffff, 0x50555c, 0.7));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(1.2, 4, 2.5);
  scene.add(sun);

  return { scene, camera, playRoot };
}

/**
 * Osvetlenie z prostredia pre fyzikálne materiály (RoomEnvironment, raz pri štarte): lesk helmy,
 * hokejky a puku a mäkké svetlo na dresoch, akoby boli v miestnosti s hráčom.
 */
export function applyEnvironment(renderer: WebGLRenderer, scene: Scene): void {
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  pmrem.dispose();
}

/** Prenesie transformáciu herného priestoru na skupinu playRoot. */
export function applyPlayFrame(playRoot: Group, frame: PlayFrame): void {
  playRoot.position.set(frame.originX, 0, frame.originZ);
  playRoot.rotation.set(0, frame.yaw, 0);
}
