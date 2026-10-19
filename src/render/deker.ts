/**
 * Režim Deker: podložka na podlahe (jemná výplň, obrys a rohové značky) a na nej svetlá (config.deker.pads).
 * - Nesvietiace svetlo: tlmená škvrna s krúžkom.
 * - Svietiace: pulzujúca svetelná škvrna (rovnaký vzhľad ako navádzanie puku) a druhý krúžok, ktorý sa
 *   počas limitu sťahuje k svetlu (koľko času zostáva).
 * - Zásah: zelený záblesk a rozplývajúci sa krúžok; minutie: sivé zhasnutie; bez kamery rýchle zhasnutie.
 * Podložka je takmer priehľadná: virtuálna vrstva v passthrough by inak prekryla skutočný puk.
 * Každé svetlo má vlastné materiály záblesku (priehľadnosť zvlášť); v slučke sa nič nealokuje.
 */
import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, type BufferGeometry } from 'three';
import type { Config } from '../config';
import type { Game } from '../core/game';
import { PALETTE, type Resources } from './materials';
import { FloorLines } from './playArea';

export type DekerFlash = 'hit' | 'miss' | 'pass';

const DURATION: Record<DekerFlash, number> = { hit: 0.45, miss: 0.5, pass: 0.3 };
const START_OPACITY: Record<DekerFlash, number> = { hit: 0.95, miss: 0.75, pass: 0.6 };
/** Krúžok v textúre navádzania má polomer 0,2 šírky textúry. */
const GUIDE_RING = 0.2;
const MAT_FILL_OPACITY = 0.05;
const IDLE_OPACITY = 0.3;
const PULSE_HZ = 1.6;

type FloorMesh = Mesh<BufferGeometry, MeshBasicMaterial>;

class Pad {
  readonly group = new Group();
  readonly flashGlow: FloorMesh;
  readonly flashRing: FloorMesh;
  kind: DekerFlash = 'pass';
  time = -1;

  constructor(r: Resources, guide: MeshBasicMaterial, idle: MeshBasicMaterial, x: number, z: number, radius: number) {
    this.group.position.set(x, 0, z);
    const size = radius / GUIDE_RING;
    const idleMesh = new Mesh(r.geometry.floorPlane, idle);
    idleMesh.scale.set(size, 1, size);
    idleMesh.position.y = 0.004;
    idleMesh.renderOrder = 3;
    this.flashGlow = new Mesh(r.geometry.floorPlane, guide.clone());
    this.flashGlow.position.y = 0.007;
    this.flashGlow.renderOrder = 5;
    this.flashRing = new Mesh(
      r.geometry.ring,
      new MeshBasicMaterial({ color: PALETTE.hit, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.flashRing.position.y = 0.008;
    this.flashRing.renderOrder = 6;
    this.flashGlow.visible = false;
    this.flashRing.visible = false;
    this.group.add(idleMesh, this.flashGlow, this.flashRing);
  }
}

export class DekerView {
  readonly root = new Group();
  private readonly pads: Pad[] = [];
  /** Svietiace svetlo: škvrna a krúžok odpočtu (zdieľané, svieti vždy len jedno). */
  private readonly glow: FloorMesh;
  private readonly timer: FloorMesh;
  private readonly radius: number;
  private time = 0;

  constructor(r: Resources, cfg: Config) {
    const d = cfg.deker;
    this.radius = d.padRadius;
    this.root.name = 'deker';
    this.root.visible = false;

    // Podložka: jemná výplň a obrys s rohovými značkami (ako plocha pre puk v DangleRush).
    const { width: w, depth, centerDistance } = d.mat;
    const near = -(centerDistance - depth / 2);
    const far = -(centerDistance + depth / 2);
    const fill = new Mesh(
      new PlaneGeometry(w, depth),
      new MeshBasicMaterial({ color: 0xdfe9f7, transparent: true, opacity: MAT_FILL_OPACITY, depthWrite: false, side: DoubleSide }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(0, 0.002, -centerDistance);
    fill.renderOrder = 1;
    const lines = new FloorLines([0.95, 0.97, 1]);
    lines.segment(-w / 2, near, w / 2, near, 0.012, 0.6);
    lines.segment(-w / 2, far, w / 2, far, 0.012, 0.6);
    lines.segment(-w / 2, near, -w / 2, far, 0.012, 0.6);
    lines.segment(w / 2, near, w / 2, far, 0.012, 0.6);
    for (const [x, z, dx, dz] of [
      [-w / 2, near, 1, -1],
      [w / 2, near, -1, -1],
      [-w / 2, far, 1, 1],
      [w / 2, far, -1, 1],
    ] as const) {
      lines.segment(x, z, x + dx * 0.12, z, 0.03, 0.9);
      lines.segment(x, z, x, z + dz * 0.12, 0.03, 0.9);
    }
    const lineMesh = new Mesh(
      lines.build(),
      new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }),
    );
    lineMesh.renderOrder = 2;
    const mat = new Group();
    mat.add(fill, lineMesh);
    mat.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    this.root.add(mat);

    const guide = r.material.guide;
    const idle = guide.clone();
    idle.color.setHex(0xffffff);
    idle.opacity = IDLE_OPACITY;
    for (const p of d.pads) {
      const pad = new Pad(r, guide, idle, p.x, p.z, d.padRadius);
      this.pads.push(pad);
      this.root.add(pad.group);
    }

    const active = guide.clone();
    active.color.setHex(PALETTE.gap);
    this.glow = new Mesh(r.geometry.floorPlane, active);
    const size = d.padRadius / GUIDE_RING;
    this.glow.scale.set(size, 1, size);
    this.glow.position.y = 0.006;
    this.glow.renderOrder = 4;
    this.timer = new Mesh(
      r.geometry.ring,
      new MeshBasicMaterial({ color: PALETTE.gap, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    );
    this.timer.position.y = 0.007;
    this.timer.renderOrder = 4;
    this.glow.visible = false;
    this.timer.visible = false;
    this.root.add(this.glow, this.timer);
  }

  /** Záblesk pri zásahu, minutí alebo prechode svetla bez kamery (udalosti dekerHit/Miss/Pass). */
  flash(index: number, kind: DekerFlash): void {
    const pad = this.pads[index];
    if (!pad) return;
    pad.kind = kind;
    pad.time = 0;
    pad.flashGlow.material.color.setHex(kind === 'hit' ? PALETTE.hit : kind === 'miss' ? PALETTE.miss : PALETTE.gap);
    pad.flashGlow.visible = true;
    pad.flashRing.visible = kind === 'hit';
    this.applyFlash(pad);
  }

  update(dt: number, game: Game): void {
    const show = game.dekerOn;
    this.root.visible = show;
    if (!show) {
      for (const pad of this.pads) this.endFlash(pad);
      return;
    }
    this.time += dt;
    const deker = game.deker;
    // Po skončení kola (GAME_OVER) už nič nesvieti.
    const lit = game.state !== 'GAME_OVER' ? deker.target : -1;
    const pad = lit >= 0 ? this.pads[lit] : undefined;
    this.glow.visible = pad !== undefined;
    this.timer.visible = pad !== undefined;
    if (pad) {
      const { x, z } = pad.group.position;
      this.glow.position.x = x;
      this.glow.position.z = z;
      this.glow.material.opacity = 0.85 + 0.15 * Math.sin(this.time * PULSE_HZ * 2 * Math.PI);
      // Krúžok odpočtu: z dvojnásobku polomeru svetla k jeho okraju.
      const left = Math.max(0, 1 - deker.targetAge / deker.timeout);
      const r = this.radius * (1 + left);
      this.timer.position.x = x;
      this.timer.position.z = z;
      this.timer.scale.set(r, 1, r);
    }
    for (const p of this.pads) {
      if (p.time < 0) continue;
      p.time += dt;
      if (p.time >= DURATION[p.kind]) this.endFlash(p);
      else this.applyFlash(p);
    }
  }

  private endFlash(pad: Pad): void {
    pad.time = -1;
    pad.flashGlow.visible = false;
    pad.flashRing.visible = false;
  }

  private applyFlash(pad: Pad): void {
    const t = Math.min(1, pad.time / DURATION[pad.kind]);
    const fade = START_OPACITY[pad.kind] * (1 - t) * (1 - t);
    const grow = pad.kind === 'hit' ? 1 + 0.3 * t : 1;
    const size = (this.radius / GUIDE_RING) * grow;
    pad.flashGlow.scale.set(size, 1, size);
    pad.flashGlow.material.opacity = fade;
    if (pad.flashRing.visible) {
      const r = this.radius * (1.2 + 1.4 * t);
      pad.flashRing.scale.set(r, 1, r);
      pad.flashRing.material.opacity = 0.8 * (1 - t);
    }
  }
}
