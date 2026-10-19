/**
 * Plocha pre puk na reálnej podlahe (obdĺžnik so stredovým krúžkom). Je vidieť pred hrou, v pauze
 * a na konci; počas hrania sa plynulo skryje, aby boli vidieť len prekážky. Jemné čiary na okrajoch
 * dráhy (config playArea.showTrack) ostávajú vidieť stále, aj počas hrania.
 * Statické čiary sú zlúčené do jedného meshu, výplň plochy je druhý mesh.
 * V režime Deker sa plocha aj okraje dráhy skryjú (podložku kreslí render/deker.ts).
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
export class FloorLines {
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

const FILL_OPACITY = 0.08;
/** Ako rýchlo sa plocha skryje alebo zobrazí (s). */
const FADE_TIME = 0.5;

/** Okraje dráhy: priehľadnosť pri hráčovi a na konci dráhy, dĺžka nábehu pri hráčovi (m), hrúbka (m). */
const TRACK_ALPHA_NEAR = 0.32;
const TRACK_ALPHA_FAR = 0.08;
const TRACK_FADE_IN = 0.6;
const TRACK_WIDTH = 0.012;

export class PlayAreaView {
  readonly root = new Group();
  /** Plocha pre puk (skrýva sa počas hrania); okraje dráhy sú mimo nej. */
  private readonly area = new Group();
  private readonly fillMaterial: MeshBasicMaterial;
  private readonly lineMaterial: MeshBasicMaterial;
  private readonly track = new Group();
  private visibility = 1;

  constructor() {
    const { width: w, depth: d, centerDistance, showTrack } = CONFIG.playArea;
    const near = -(centerDistance - d / 2);
    const far = -(centerDistance + d / 2);
    const end = -CONFIG.obstacles.spawnDistance;
    this.root.name = 'playArea';
    this.root.add(this.area, this.track);

    this.fillMaterial = new MeshBasicMaterial({
      color: 0xbcd6ff,
      transparent: true,
      opacity: FILL_OPACITY,
      depthWrite: false,
      side: DoubleSide,
    });
    const fill = new Mesh(new PlaneGeometry(w, d), this.fillMaterial);
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(0, FILL_Y, -centerDistance);
    fill.renderOrder = 1;
    this.area.add(fill);

    const lines = new FloorLines([0.95, 0.97, 1]);
    // Obvod plochy.
    lines.segment(-w / 2, near, w / 2, near, 0.012, 0.75);
    lines.segment(-w / 2, far, w / 2, far, 0.012, 0.75);
    lines.segment(-w / 2, near, -w / 2, far, 0.012, 0.75);
    lines.segment(w / 2, near, w / 2, far, 0.012, 0.75);
    // Rohové značky (hrubšie), ako na tréningovej ploche.
    for (const [x, z, dx, dz] of [
      [-w / 2, near, 1, -1],
      [w / 2, near, -1, -1],
      [-w / 2, far, 1, 1],
      [w / 2, far, -1, 1],
    ] as const) {
      lines.segment(x, z, x + dx * 0.12, z, 0.03, 0.95);
      lines.segment(x, z, x, z + dz * 0.12, 0.03, 0.95);
    }
    // Stred plochy: sem patrí puk na začiatku.
    lines.ring(0, -centerDistance, 0.07, 0.012, 0.8);
    lines.segment(-0.03, -centerDistance, 0.03, -centerDistance, 0.008, 0.8);
    lines.segment(0, -centerDistance - 0.03, 0, -centerDistance + 0.03, 0.008, 0.8);
    this.lineMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const lineMesh = new Mesh(lines.build(), this.lineMaterial);
    lineMesh.renderOrder = 2;
    this.area.add(lineMesh);

    if (showTrack) {
      // Jemné čiary na okrajoch dráhy: pri hráčovi plynulý nábeh, smerom do diaľky slabnú až po miesto spawnu.
      const track = new FloorLines([0.95, 0.97, 1]);
      for (const x of [-w / 2, w / 2]) {
        track.segment(x, near, x, near - TRACK_FADE_IN, TRACK_WIDTH, 0, TRACK_ALPHA_NEAR);
        const steps = 6;
        const z0 = near - TRACK_FADE_IN;
        for (let i = 0; i < steps; i++) {
          const a = z0 + ((end - z0) * i) / steps;
          const b = z0 + ((end - z0) * (i + 1)) / steps;
          const alpha = (k: number) => TRACK_ALPHA_NEAR + (TRACK_ALPHA_FAR - TRACK_ALPHA_NEAR) * k;
          track.segment(x, a, x, b, TRACK_WIDTH, alpha(i / steps), alpha((i + 1) / steps));
        }
      }
      const trackMesh = new Mesh(
        track.build(),
        new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }),
      );
      trackMesh.renderOrder = 2;
      this.track.add(trackMesh);
    }

    // Statické voči playRoot: lokálne matice netreba prepočítavať každý snímok.
    this.root.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  /**
   * Počas hrania sa plocha plynulo skryje (ak config.playArea.showWhilePlaying nie je zapnuté).
   * V Dekeri (dekerOn) sa skryje aj s okrajmi dráhy.
   */
  update(dt: number, playing: boolean, dekerOn = false): void {
    this.track.visible = !dekerOn;
    const target = (playing && !CONFIG.playArea.showWhilePlaying) || dekerOn ? 0 : 1;
    if (this.visibility === target) return;
    const step = dt / FADE_TIME;
    this.visibility = target > this.visibility
      ? Math.min(target, this.visibility + step)
      : Math.max(target, this.visibility - step);
    this.fillMaterial.opacity = FILL_OPACITY * this.visibility;
    this.lineMaterial.opacity = this.visibility;
    this.area.visible = this.visibility > 0.001;
  }
}
