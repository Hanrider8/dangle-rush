/**
 * Efekty: červená vinieta pri zásahu. Je to jediný prvok pripnutý k hlave; pózu berie
 * priamo z aktuálneho XR snímku, aby nezaostávala o snímok.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { HeadSample } from '../core/types';

const DURATION = 0.65;
const DISTANCE = 0.3;

function vignetteTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(255, 30, 50, 0)');
  g.addColorStop(0.55, 'rgba(255, 30, 50, 0.35)');
  g.addColorStop(1, 'rgba(255, 20, 40, 0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class HitVignette {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private time = 0;
  private readonly q = new Quaternion();
  private readonly offset = new Vector3();

  constructor() {
    // Pri 0,3 m pokryje rovina 1,6 m zhruba ±70° zorného poľa.
    this.mesh = new Mesh(
      new PlaneGeometry(1.6, 1.6),
      new MeshBasicMaterial({
        map: vignetteTexture(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.renderOrder = 2000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  trigger(): void {
    this.time = DURATION;
  }

  update(dt: number, head: HeadSample): void {
    if (this.time <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.time -= dt;
    this.mesh.visible = true;
    this.mesh.material.opacity = Math.pow(Math.max(0, this.time) / DURATION, 0.6);
    this.q.set(head.qx, head.qy, head.qz, head.qw);
    this.offset.set(0, 0, -DISTANCE).applyQuaternion(this.q);
    this.mesh.position.set(head.px + this.offset.x, head.py + this.offset.y, head.pz + this.offset.z);
    this.mesh.quaternion.copy(this.q);
  }
}
