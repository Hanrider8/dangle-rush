/**
 * Len pre vývoj: virtuálna kamera headsetu pre test `?cam=1&camsim=1` v emulátore IWER.
 *
 * Vykreslí podlahu zo svetlého dreva a zelený biscuit (s `&camball=orange` lososovo-oranžovú loptičku)
 * z pohľadu kamery pripevnenej k emulovanej hlave so známymi parametrami (SIM_CAMERA). Póza hlavy sa berie spred SIM_CAMERA.latencyMs,
 * ako pri skutočnej kamere s oneskorením. Obraz ide cez canvas.captureStream() do rovnakého
 * spracovania ako kamera Questu, takže kalibrácia by mala nájsť práve tieto parametre.
 * Biscuit je aj v AR scéne (zastupuje skutočný puk, ktorý by bolo vidieť v passthrough).
 */
import type { XRDevice } from 'iwer';
import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { App } from '../app';
import { CONFIG } from '../config';
import type { Vec3 } from '../core/types';
import { quatFromRotVec, type CamParams } from '../tracking/cameraModel';
import { PoseHistory, createPose } from '../tracking/poseHistory';

/** Skutočná (simulovaná) kamera: kalibrácia by mala nájsť tieto hodnoty. */
export const SIM_CAMERA: CamParams = {
  width: 320,
  height: 240,
  f: 215,
  cx: 163,
  cy: 118,
  rx: -0.12,
  ry: 0.03,
  rz: 0.012,
  tx: 0.033,
  ty: -0.012,
  tz: -0.078,
  latencyMs: 40,
};

function woodTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#cfa97c';
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    const shade = Math.sin(y * 0.09) * 10 + Math.sin(y * 0.023) * 14;
    ctx.fillStyle = `rgba(120, 80, 40, ${0.05 + Math.abs(shade) / 160})`;
    ctx.fillRect(0, y, size, 1);
  }
  ctx.fillStyle = 'rgba(90, 60, 30, 0.35)';
  for (let y = 0; y < size; y += 128) ctx.fillRect(0, y, size, 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(6, 6);
  return texture;
}

export function installCameraSim(app: App, device: XRDevice): () => MediaStream {
  const p = SIM_CAMERA;
  const orange = new URLSearchParams(location.search).get('camball') === 'orange';
  const target = CONFIG.camera.targets[orange ? 'orange' : 'green'];
  const radius = target.radius;
  /** Biscuit: valec s priemerom puku; loptička: guľa. Stred je vo výške centerHeight. */
  const height = 2 * target.centerHeight;
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(p.width, p.height, false);

  const scene = new Scene();
  scene.background = new Color(0x2c2a28);
  scene.add(new HemisphereLight(0xffffff, 0x444444, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 3, 2);
  scene.add(sun);
  const floor = new Mesh(new PlaneGeometry(14, 14).rotateX(-Math.PI / 2), new MeshLambertMaterial({ map: woodTexture() }));
  scene.add(floor);
  const ballGeometry = orange ? new SphereGeometry(radius, 32, 16) : new CylinderGeometry(radius, radius, height, 32);
  const ballColor = orange ? 0xf0805c : 0x3fd24a;
  const ball = new Mesh(
    ballGeometry,
    new MeshLambertMaterial({ color: ballColor, emissive: orange ? 0x3a1a10 : 0x0f3a12 }),
  );
  scene.add(ball);
  // Biscuit v AR scéne: v emulátore zastupuje skutočný puk.
  const arBall = new Mesh(ballGeometry, new MeshBasicMaterial({ color: ballColor }));
  app.rig.playRoot.add(arBall);

  // Projekcia dierkovej komory s daným f, cx, cy (v NDC ide y nahor, v obraze v nadol).
  const near = 0.03;
  const far = 40;
  const camera = new PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  camera.projectionMatrix.set(
    (2 * p.f) / p.width, 0, 1 - (2 * p.cx) / p.width, 0,
    0, (2 * p.f) / p.height, (2 * p.cy) / p.height - 1, 0,
    0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near),
    0, 0, -1, 0,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  const q = quatFromRotVec(p.rx, p.ry, p.rz, { x: 0, y: 0, z: 0, w: 1 });
  const offset = new Matrix4().compose(
    new Vector3(p.tx, p.ty, p.tz),
    new Quaternion(q.x, q.y, q.z, q.w),
    new Vector3(1, 1, 1),
  );
  const headMatrix = new Matrix4();
  const headPos = new Vector3();
  const headQuat = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const history = new PoseHistory(600);
  const pose = createPose();
  const ballPlay = { x: 0.15, z: -0.9 };
  const world: Vec3 = { x: 0, y: 0, z: 0 };

  const loop = (): void => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const d = device;
    history.push(now, d.position.x, d.position.y, d.position.z, d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w);
    arBall.position.set(ballPlay.x, height / 2, ballPlay.z);
    if (!history.sample(now - p.latencyMs, pose)) return;
    app.game.playFrame.toWorldPoint(world, ballPlay.x, height / 2, ballPlay.z);
    ball.position.set(world.x, world.y, world.z);
    headMatrix.compose(headPos.set(pose.px, pose.py, pose.pz), headQuat.set(pose.qx, pose.qy, pose.qz, pose.qw), one);
    camera.matrix.multiplyMatrices(headMatrix, offset);
    camera.matrixWorldNeedsUpdate = true;
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);

  const api = (window as unknown as { __dr?: Record<string, unknown> }).__dr;
  if (api) {
    api.camSim = {
      truth: SIM_CAMERA,
      ball: ballPlay,
      canvas,
      /** Presunie biscuit (herný priestor, m). */
      setBall(x: number, z: number): void {
        ballPlay.x = x;
        ballPlay.z = z;
      },
    };
  }
  return () => canvas.captureStream(30);
}
