/**
 * Spätná väzba pri prvkoch na zemi. Prvok po posúdení zmizne (obstacleViews ho skryje)
 * a namiesto neho sa na chvíľu ukáže jeho „duch“:
 * - puk prešiel: zelený, mierne sa zväčší a zmizne, okolo miesta pre puk sa rozplynie krúžok,
 * - puk minul: sivý, pomaly zmizne,
 * - bez kamery (len prešiel plochou): v pôvodnej farbe, rýchlo zmizne.
 * Efekt ide s prekážkou k hráčovi. Pool s vlastnými materiálmi (priehľadnosť každého efektu zvlášť).
 */
import { Color, Group, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry } from 'three';
import type { Config } from '../config';
import type { Obstacle } from '../core/obstacles';
import type { GameplaySim } from '../core/sim';
import { PALETTE, type Resources } from './materials';

export type FeedbackKind = 'hit' | 'miss' | 'pass';

const POOL = 16;
const DURATION: Record<FeedbackKind, number> = { hit: 0.42, miss: 0.5, pass: 0.28 };
const START_OPACITY: Record<FeedbackKind, number> = { hit: 0.95, miss: 0.75, pass: 0.55 };

class Effect {
  readonly group = new Group();
  readonly ghosts: Mesh<BufferGeometry, MeshBasicMaterial>[] = [];
  readonly ring: Mesh<BufferGeometry, MeshBasicMaterial>;
  /** Mierka duchov pri vzniku (zväčšovanie pri úspechu je voči nej). */
  readonly base = [new Vector3(), new Vector3()];
  active = false;
  kind: FeedbackKind = 'pass';
  time = 0;
  obstacle: Obstacle | null = null;
  id = 0;
  dz = 0;
  ringX = 0;

  constructor(r: Resources) {
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(
        r.geometry.cone as BufferGeometry,
        new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
      );
      m.renderOrder = 5;
      this.ghosts.push(m);
      this.group.add(m);
    }
    this.ring = new Mesh(
      r.geometry.ring as BufferGeometry,
      new MeshBasicMaterial({ color: PALETTE.hit, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.ring.renderOrder = 6;
    this.group.add(this.ring);
    this.group.visible = false;
  }
}

export class FloorFeedback {
  readonly root = new Group();
  private readonly effects: Effect[] = [];
  private next = 0;
  private readonly color = new Color();

  constructor(
    private readonly r: Resources,
    private readonly cfg: Config,
  ) {
    for (let i = 0; i < POOL; i++) {
      const e = new Effect(r);
      this.effects.push(e);
      this.root.add(e.group);
    }
  }

  /** Efekt pre prvok `elem` prekážky `o` (volá sa pri udalosti floorHit/floorMiss/floorPass). */
  spawn(o: Obstacle, elem: number, kind: FeedbackKind): void {
    const e = this.freeEffect();
    const g = this.r.geometry;
    const c = this.cfg.obstacles;
    const [a, b] = e.ghosts as [Mesh<BufferGeometry, MeshBasicMaterial>, Mesh<BufferGeometry, MeshBasicMaterial>];
    a.visible = true;
    b.visible = false;
    a.rotation.set(0, 0, 0);
    let original: number = PALETTE.cone;
    const x = o.elemX[elem]!;
    e.ringX = o.elemPuckX[elem]!;
    switch (o.kind) {
      case 'stars':
        a.geometry = g.star;
        a.position.set(x, 0.014, 0);
        a.scale.setScalar(c.stars.radius);
        original = PALETTE.star;
        break;
      case 'coneGate':
      case 'wideDangle': {
        const off = o.gapW / 2 + c.coneGate.coneRadius;
        for (const [m, sx] of [
          [a, -1],
          [b, 1],
        ] as const) {
          m.geometry = g.cone;
          m.visible = true;
          m.position.set(x + sx * off, 0, 0);
          m.scale.set(c.coneGate.coneRadius, c.coneGate.coneHeight, c.coneGate.coneRadius);
        }
        break;
      }
      case 'slalom':
        a.geometry = g.cone;
        a.position.set(x, 0, 0);
        a.scale.set(c.coneGate.coneRadius, c.coneGate.coneHeight, c.coneGate.coneRadius);
        break;
      case 'lowBar':
        a.geometry = g.rod;
        a.position.set((o.x0 + o.x1) / 2, o.height / 2, 0);
        a.scale.set(o.x1 - o.x0, o.height, o.height);
        original = PALETTE.lowBar;
        e.ringX = o.gapX;
        break;
      case 'pokeCheck':
        a.geometry = g.box;
        a.position.set(o.sweepTo, 0.02, 0);
        a.scale.set(o.x1 - o.x0, 0.035, 0.035);
        original = PALETTE.stick;
        e.ringX = o.gapX;
        break;
      default:
        return;
    }
    this.color.setHex(kind === 'hit' ? PALETTE.hit : kind === 'miss' ? PALETTE.miss : original);
    for (let i = 0; i < 2; i++) {
      e.ghosts[i]!.material.color.copy(this.color);
      e.base[i]!.copy(e.ghosts[i]!.scale);
    }
    e.ring.visible = kind === 'hit';
    e.ring.position.set(e.ringX, 0.01, 0);
    e.active = true;
    e.kind = kind;
    e.time = 0;
    e.obstacle = o;
    e.id = o.id;
    e.dz = o.elemDz[elem]!;
    e.group.visible = true;
    e.group.position.set(0, 0, o.z + e.dz);
    this.apply(e);
  }

  /** Každý snímok: animácia a pohyb s prekážkou (alpha = interpolácia medzi krokmi simulácie). */
  update(dt: number, alpha: number, sim: GameplaySim): void {
    for (const e of this.effects) {
      if (!e.active) continue;
      e.time += dt;
      if (e.time >= DURATION[e.kind]) {
        e.active = false;
        e.group.visible = false;
        e.obstacle = null;
        continue;
      }
      const o = e.obstacle;
      if (o && o.active && o.id === e.id) e.group.position.z = o.prevZ + (o.z - o.prevZ) * alpha + e.dz;
      else e.group.position.z += sim.speed * dt;
      this.apply(e);
    }
  }

  /** Voľný efekt, inak najstarší v poradí. */
  private freeEffect(): Effect {
    for (let i = 0; i < this.effects.length; i++) if (!this.effects[i]!.active) return this.effects[i]!;
    return this.effects[this.next++ % POOL]!;
  }

  clear(): void {
    for (const e of this.effects) {
      e.active = false;
      e.group.visible = false;
      e.obstacle = null;
    }
  }

  private apply(e: Effect): void {
    const t = Math.min(1, e.time / DURATION[e.kind]);
    const fade = START_OPACITY[e.kind] * (1 - t) * (1 - t);
    const grow = e.kind === 'hit' ? 1 + 0.25 * t : 1;
    // Duch sa zväčšuje okolo vlastného stredu: škálovanie celej skupiny by ho posunulo do strany.
    for (let i = 0; i < 2; i++) {
      const m = e.ghosts[i]!;
      m.material.opacity = fade;
      if (m.visible) m.scale.copy(e.base[i]!).multiplyScalar(grow);
    }
    if (e.ring.visible) {
      const r = 0.12 + 0.24 * t;
      e.ring.scale.set(r, 1, r);
      e.ring.material.opacity = 0.8 * (1 - t);
    }
  }
}
