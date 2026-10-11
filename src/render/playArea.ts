/**
 * Plocha pre loptičku a slabé čiary dráhy na reálnej podlahe.
 * Statické čiary sú zlúčené do jedného meshu, výplň plochy je druhý mesh.
 */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { CONFIG } from '../config';

const FILL_Y = 0.002;
const LINE_Y = 0.004;

/** Tenké obdĺžniky ležiace na podlahe, s priehľadnosťou vo vertex farbách. */
class FloorLines {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  constructor(private readonly rgb: [number, number, number]) {}

  segment(x0: number, z0: number, x1: number, z1: number, width: number, a0: number, a1 = a0): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const nx = (-(z1 - z0) / len) * (width / 2);
    const nz = ((x1 - x0) / len) * (width / 2);
    const base = this.positions.length / 3;
    this.positions.push(
      x0 + nx, LINE_Y, z0 + nz,
      x0 - nx, LINE_Y, z0 - nz,
      x1 + nx, LINE_Y, z1 + nz,
      x1 - nx, LINE_Y, z1 - nz,
    );
    const [r, g, b] = this.rgb;
    this.colors.push(r, g, b, a0, r, g, b, a0, r, g, b, a1, r, g, b, a1);
    this.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  ring(cx: number, cz: number, radius: number, width: number, alpha: number, segments = 24): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.segment(
        cx + Math.cos(a0) * radius, cz + Math.sin(a0) * radius,
        cx + Math.cos(a1) * radius, cz + Math.sin(a1) * radius,
        width, alpha,
      );
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 4));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

export function createPlayArea(): Group {
  const { width: w, depth: d, centerDistance } = CONFIG.playArea;
  const near = -(centerDistance - d / 2);
  const far = -(centerDistance + d / 2);
  const end = -CONFIG.obstacles.spawnDistance;
  const group = new Group();
  group.name = 'playArea';

  const fill = new Mesh(
    new PlaneGeometry(w, d),
    new MeshBasicMaterial({
      color: 0x5cc8ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(0, FILL_Y, -centerDistance);
  fill.renderOrder = 1;
  group.add(fill);

  const lines = new FloorLines([0.75, 0.95, 1]);
  // Obvod plochy.
  lines.segment(-w / 2, near, w / 2, near, 0.02, 0.7);
  lines.segment(-w / 2, far, w / 2, far, 0.02, 0.7);
  lines.segment(-w / 2, near, -w / 2, far, 0.02, 0.7);
  lines.segment(w / 2, near, w / 2, far, 0.02, 0.7);
  // Stred plochy: sem patrí loptička na začiatku.
  lines.ring(0, -centerDistance, 0.07, 0.012, 0.8);
  lines.segment(-0.03, -centerDistance, 0.03, -centerDistance, 0.008, 0.8);
  lines.segment(0, -centerDistance - 0.03, 0, -centerDistance + 0.03, 0.008, 0.8);
  // Dráha: okraje slabnú smerom do diaľky, v strede prerušovaná čiara.
  lines.segment(-w / 2, far, -w / 2, end, 0.025, 0.45, 0.12);
  lines.segment(w / 2, far, w / 2, end, 0.025, 0.45, 0.12);
  for (let z = far - 0.25; z > end + 0.25; z -= 0.6) {
    const t = (far - z) / (far - end);
    lines.segment(0, z, 0, z - 0.3, 0.015, 0.3 * (1 - t) + 0.08);
  }
  // Čiara spawnu na konci dráhy.
  lines.segment(-w / 2, end, w / 2, end, 0.02, 0.2);

  const lineMesh = new Mesh(
    lines.build(),
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  lineMesh.renderOrder = 2;
  group.add(lineMesh);

  // Statické voči playRoot: lokálne matice netreba prepočítavať každý snímok.
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  return group;
}
