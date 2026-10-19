/**
 * Režim Deker: podložka na podlahe (jemná výplň, obrys a rohové značky) a na nej svetlo na náhodnom mieste.
 * - Svietiace svetlo: pulzujúca svetelná škvrna (rovnaký vzhľad ako navádzanie puku) a druhý krúžok, ktorý
 *   sa počas limitu sťahuje k svetlu (koľko času zostáva).
 * - Zásah: zelený záblesk a rozplývajúci sa krúžok; minutie: sivé zhasnutie; bez kamery rýchle zhasnutie.
 * Podložka je takmer priehľadná: virtuálna vrstva v passthrough by inak prekryla skutočný puk.
 * Záblesky sú malý pool s vlastnými materiálmi (priehľadnosť zvlášť); v slučke sa nič nealokuje.
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
const PULSE_HZ = 1.6;
/** Záblesky môžu krátko bežať naraz (zásah a hneď ďalší zásah). */
const FLASH_POOL = 4;

type FloorMesh = Mesh<BufferGeometry, MeshBasicMaterial>;

class Flash {
  readonly group = new Group();
  readonly glow: FloorMesh;
  readonly ring: FloorMesh;
  kind: DekerFlash = 'pass';
  time = -1;
  radius = 0.1;

  constructor(r: Resources, guide: MeshBasicMaterial) {
    this.glow = new Mesh(r.geometry.floorPlane, guide.clone());
    this.glow.position.y = 0.007;
    this.glow.renderOrder = 5;
    this.ring = new Mesh(
      r.geometry.ring,
      new MeshBasicMaterial({ color: PALETTE.hit, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.ring.position.y = 0.008;
    this.ring.renderOrder = 6;
    this.group.add(this.glow, this.ring);
    this.group.visible = false;
  }
}

export class DekerView {
  readonly root = new Group();
  private readonly flashes: Flash[] = [];
  private next = 0;
  /** Svietiace svetlo: škvrna a krúžok odpočtu (svieti vždy len jedno). */
  private readonly glow: FloorMesh;
  private readonly timer: FloorMesh;
  private time = 0;

  constructor(r: Resources, cfg: Config) {
    const d = cfg.deker;
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
    for (let i = 0; i < FLASH_POOL; i++) {
      const f = new Flash(r, guide);
      this.flashes.push(f);
      this.root.add(f.group);
    }

    const active = guide.clone();
    active.color.setHex(PALETTE.gap);
    this.glow = new Mesh(r.geometry.floorPlane, active);
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

  /**
   * Záblesk na mieste posúdeného svetla (udalosti dekerHit/Miss/Pass, poloha z DekerSim.lastX/lastZ,
   * polomer svetla podľa veľkosti cieľa).
   */
  flash(x: number, z: number, radius: number, kind: DekerFlash): void {
    // Voľný záblesk, inak najstarší v poradí.
    let f = this.flashes[this.next++ % FLASH_POOL]!;
    for (let i = 0; i < this.flashes.length; i++) {
      if (this.flashes[i]!.time < 0) {
        f = this.flashes[i]!;
        break;
      }
    }
    f.kind = kind;
    f.time = 0;
    f.radius = radius;
    f.group.position.set(x, 0, z);
    f.glow.material.color.setHex(kind === 'hit' ? PALETTE.hit : kind === 'miss' ? PALETTE.miss : PALETTE.gap);
    f.ring.visible = kind === 'hit';
    f.group.visible = true;
    this.apply(f);
  }

  update(dt: number, game: Game): void {
    const show = game.dekerOn;
    this.root.visible = show;
    if (!show) {
      for (const f of this.flashes) this.end(f);
      return;
    }
    this.time += dt;
    const deker = game.deker;
    // Po skončení kola (GAME_OVER) už nič nesvieti.
    const lit = deker.lit && game.state !== 'GAME_OVER';
    this.glow.visible = lit;
    this.timer.visible = lit;
    if (lit) {
      const x = deker.targetX;
      const z = deker.targetZ;
      const size = deker.radius / GUIDE_RING;
      this.glow.scale.set(size, 1, size);
      this.glow.position.x = x;
      this.glow.position.z = z;
      this.glow.material.opacity = 0.85 + 0.15 * Math.sin(this.time * PULSE_HZ * 2 * Math.PI);
      // Krúžok odpočtu: z dvojnásobku polomeru svetla k jeho okraju.
      const left = Math.max(0, 1 - deker.targetAge / deker.timeout);
      const r = deker.radius * (1 + left);
      this.timer.position.x = x;
      this.timer.position.z = z;
      this.timer.scale.set(r, 1, r);
    }
    for (const f of this.flashes) {
      if (f.time < 0) continue;
      f.time += dt;
      if (f.time >= DURATION[f.kind]) this.end(f);
      else this.apply(f);
    }
  }

  private end(f: Flash): void {
    f.time = -1;
    f.group.visible = false;
  }

  private apply(f: Flash): void {
    const t = Math.min(1, f.time / DURATION[f.kind]);
    const fade = START_OPACITY[f.kind] * (1 - t) * (1 - t);
    const grow = f.kind === 'hit' ? 1 + 0.3 * t : 1;
    const size = (f.radius / GUIDE_RING) * grow;
    f.glow.scale.set(size, 1, size);
    f.glow.material.opacity = fade;
    if (f.ring.visible) {
      const r = f.radius * (1.2 + 1.4 * t);
      f.ring.scale.set(r, 1, r);
      f.ring.material.opacity = 0.8 * (1 - t);
    }
  }
}
