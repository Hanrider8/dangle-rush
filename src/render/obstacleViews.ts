/**
 * Meshe prekážok. Pre každý typ je predalokovaný pool pohľadov, ktoré sa len zapínajú,
 * nastavia podľa prekážky (bind) a posúvajú. Pozícia v z sa interpoluje medzi krokmi simulácie.
 */
import { Group, Mesh, type BufferGeometry, type Material } from 'three';
import type { Config } from '../config';
import { MAX_OBSTACLES, type Obstacle } from '../core/obstacles';
import type { GameplaySim } from '../core/sim';
import type { ObstacleKind } from '../core/types';
import type { Resources } from './materials';

const POOL_PER_KIND = 6;
const RIM = 0.035;
const FADE_TIME = 0.22;
const DEFENDER_HEIGHT = 1.75;

interface ObstacleView {
  readonly kind: ObstacleKind;
  readonly group: Group;
  bind(o: Obstacle, eyeHeight: number): void;
}

function mesh(geometry: BufferGeometry, material: Material, renderOrder = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.renderOrder = renderOrder;
  return m;
}

/** Kváder z jednotkovej geometrie: stred a rozmery. */
function setBox(m: Mesh, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, grow = 0): void {
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.scale.set(x1 - x0 + grow, y1 - y0 + grow, z1 - z0 + grow);
}

/** Blob tieň na podlahe. */
function setShadow(m: Mesh, x: number, width: number, depth: number): void {
  m.position.set(x, 0.006, 0);
  m.scale.set(width, 1, depth);
}

class HighBarView implements ObstacleView {
  readonly kind = 'highBar' as const;
  readonly group = new Group();
  private readonly bar: Mesh;
  private readonly rim: Mesh;
  private readonly curtain: Mesh;
  private readonly postL: Mesh;
  private readonly postR: Mesh;
  private readonly shadow: Mesh;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    const g = r.geometry;
    const m = r.material;
    this.bar = mesh(g.box, m.highBar);
    this.rim = mesh(g.box, m.highBarRim, 1);
    this.curtain = mesh(g.plane, m.highBarCurtain, 2);
    this.postL = mesh(g.box, m.highBar);
    this.postR = mesh(g.box, m.highBar);
    this.shadow = mesh(g.floorPlane, m.shadow, 3);
    this.group.add(this.shadow, this.postL, this.postR, this.bar, this.rim, this.curtain);
  }

  bind(o: Obstacle): void {
    const c = this.cfg.obstacles.highBar;
    const y = o.height;
    const t = c.thickness;
    const w = c.width;
    setBox(this.bar, -w / 2, y, -t / 2, w / 2, y + t, t / 2);
    setBox(this.rim, -w / 2, y, -t / 2, w / 2, y + t, t / 2, RIM);
    setBox(this.postL, -w / 2 - 0.05, 0, -0.03, -w / 2 + 0.01, y + t, 0.03);
    setBox(this.postR, w / 2 - 0.01, 0, -0.03, w / 2 + 0.05, y + t, 0.03);
    // Slabý „záves“ nad tyčou: hore sa nedá prejsť, treba sa zohnúť.
    this.curtain.position.set(0, y + t + 0.3, 0);
    this.curtain.scale.set(w, 0.6, 1);
    setShadow(this.shadow, 0, w * 0.8, 0.5);
  }
}

/** Defender (silueta obrancu) a priesvitná zóna, ktorú treba obísť. */
class Defender {
  readonly body: Mesh;
  readonly rim: Mesh;
  readonly zone: Mesh;
  readonly shadow: Mesh;

  constructor(r: Resources, solid: Material, rim: Material, zone: Material) {
    this.body = mesh(r.geometry.defender, solid);
    this.rim = mesh(r.geometry.defender, rim, 1);
    this.zone = mesh(r.geometry.box, zone, 2);
    this.shadow = mesh(r.geometry.floorPlane, r.material.shadow, 3);
  }

  addTo(group: Group): void {
    group.add(this.shadow, this.body, this.rim, this.zone);
  }

  /** Zóna od x0 po x1, defender pri vnútornej hrane (innerX), otočený čelom k hráčovi. */
  set(x0: number, x1: number, innerX: number, top: number, depth: number): void {
    setBox(this.zone, x0, 0, -depth / 2, x1, top, depth / 2);
    // Prilba defendera siaha po vrch kolíznej zóny.
    const scale = Math.max(0.75, Math.min(1.3, top / DEFENDER_HEIGHT));
    const towardOuter = innerX > (x0 + x1) / 2 ? -1 : 1;
    const x = innerX + towardOuter * 0.38 * scale;
    this.body.position.set(x, 0, 0);
    this.body.scale.set(towardOuter * scale, scale, scale);
    this.rim.position.copy(this.body.position);
    this.rim.scale.set(towardOuter * scale * 1.05, scale * 1.02, scale * 1.08);
    setShadow(this.shadow, (x0 + x1) / 2, Math.abs(x1 - x0) * 1.1, depth * 2.2);
  }
}

class SideBlockView implements ObstacleView {
  readonly kind = 'sideBlock' as const;
  readonly group = new Group();
  private readonly defender: Defender;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    const m = r.material;
    this.defender = new Defender(r, m.sideBlock, m.sideBlockRim, m.sideBlockZone);
    this.defender.addTo(this.group);
  }

  bind(o: Obstacle): void {
    const c = this.cfg.obstacles.sideBlock;
    if (o.side < 0) this.defender.set(-c.outerX, c.innerX, c.innerX, o.height, c.depth);
    else this.defender.set(-c.innerX, c.outerX, -c.innerX, o.height, c.depth);
  }
}

class DoubleBlockView implements ObstacleView {
  readonly kind = 'doubleBlock' as const;
  readonly group = new Group();
  private readonly left: Defender;
  private readonly right: Defender;
  private readonly window: Mesh;
  private readonly edgeL: Mesh;
  private readonly edgeR: Mesh;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    const m = r.material;
    this.left = new Defender(r, m.doubleBlock, m.doubleBlockRim, m.doubleBlockZone);
    this.right = new Defender(r, m.doubleBlock, m.doubleBlockRim, m.doubleBlockZone);
    this.left.addTo(this.group);
    this.right.addTo(this.group);
    this.window = mesh(r.geometry.plane, m.gapWindow, 4);
    this.edgeL = mesh(r.geometry.box, m.gapEdge);
    this.edgeR = mesh(r.geometry.box, m.gapEdge);
    this.group.add(this.window, this.edgeL, this.edgeR);
  }

  bind(o: Obstacle, eyeHeight: number): void {
    const c = this.cfg.obstacles.sideBlock;
    const gl = o.gapX - o.gapW / 2;
    const gr = o.gapX + o.gapW / 2;
    this.left.set(-c.outerX, gl, gl, o.height, c.depth);
    this.right.set(gr, c.outerX, gr, o.height, c.depth);
    // Zelené „okno“ vo výške hlavy: tadiaľto musí ísť hlava.
    const y0 = eyeHeight * 0.55;
    const y1 = o.height;
    this.window.position.set(o.gapX, (y0 + y1) / 2, 0);
    this.window.scale.set(o.gapW, y1 - y0, 1);
    setBox(this.edgeL, gl - 0.015, y0, -0.015, gl + 0.015, y1, 0.015);
    setBox(this.edgeR, gr - 0.015, y0, -0.015, gr + 0.015, y1, 0.015);
  }
}

/** Zelený pruh so šípkami na zemi: sem patrí loptička. */
function setGapStrip(m: Mesh, gapX: number, gapW: number): void {
  m.position.set(gapX, 0.008, 0);
  m.scale.set(Math.max(0.05, gapW - 0.04), 1, 0.5);
}

class LowBarView implements ObstacleView {
  readonly kind = 'lowBar' as const;
  readonly group = new Group();
  private readonly bar: Mesh;
  private readonly rim: Mesh;
  private readonly strip: Mesh;
  private readonly shadow: Mesh;

  constructor(r: Resources) {
    const g = r.geometry;
    const m = r.material;
    this.bar = mesh(g.rod, m.lowBar);
    this.rim = mesh(g.rod, m.lowBarRim, 1);
    this.strip = mesh(g.floorPlane, m.gapStrip, 3);
    this.shadow = mesh(g.floorPlane, m.shadow, 2);
    this.group.add(this.shadow, this.strip, this.bar, this.rim);
  }

  bind(o: Obstacle): void {
    const len = o.x1 - o.x0;
    const d = o.height;
    this.bar.position.set((o.x0 + o.x1) / 2, d / 2, 0);
    this.bar.scale.set(len, d, d);
    this.rim.position.copy(this.bar.position);
    this.rim.scale.set(len + RIM, d + RIM, d + RIM);
    setGapStrip(this.strip, o.gapX, o.gapW);
    setShadow(this.shadow, (o.x0 + o.x1) / 2, len * 1.05, 0.2);
  }
}

class ConeGateView implements ObstacleView {
  readonly kind = 'coneGate' as const;
  readonly group = new Group();
  private readonly cones: Mesh[] = [];
  private readonly rims: Mesh[] = [];
  private readonly shadows: Mesh[] = [];
  private readonly strip: Mesh;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    const g = r.geometry;
    const m = r.material;
    this.strip = mesh(g.floorPlane, m.gapStrip, 3);
    this.group.add(this.strip);
    for (let i = 0; i < 2; i++) {
      const shadow = mesh(g.floorPlane, m.shadow, 2);
      const cone = mesh(g.cone, m.cone);
      const rim = mesh(g.cone, m.coneRim, 1);
      this.shadows.push(shadow);
      this.cones.push(cone);
      this.rims.push(rim);
      this.group.add(shadow, cone, rim);
    }
  }

  bind(o: Obstacle): void {
    const c = this.cfg.obstacles.coneGate;
    for (let i = 0; i < 2; i++) {
      const x = o.gapX + (i === 0 ? -1 : 1) * (o.gapW / 2 + c.coneRadius);
      this.cones[i]!.position.set(x, 0, 0);
      this.cones[i]!.scale.set(c.coneRadius, c.coneHeight, c.coneRadius);
      this.rims[i]!.position.set(x, -RIM / 2, 0);
      this.rims[i]!.scale.set(c.coneRadius + RIM, c.coneHeight + RIM, c.coneRadius + RIM);
      setShadow(this.shadows[i]!, x, c.coneRadius * 4, c.coneRadius * 4);
    }
    setGapStrip(this.strip, o.gapX, o.gapW);
  }
}

interface Slot {
  id: number;
  view: ObstacleView | null;
}

interface Fading {
  view: ObstacleView;
  time: number;
}

export class ObstacleViews {
  readonly root = new Group();
  private readonly free = new Map<ObstacleKind, ObstacleView[]>();
  private readonly slots: Slot[] = [];
  private readonly fading: Fading[] = [];

  constructor(resources: Resources, cfg: Config) {
    const make: Record<ObstacleKind, () => ObstacleView> = {
      highBar: () => new HighBarView(resources, cfg),
      sideBlock: () => new SideBlockView(resources, cfg),
      doubleBlock: () => new DoubleBlockView(resources, cfg),
      lowBar: () => new LowBarView(resources),
      coneGate: () => new ConeGateView(resources, cfg),
    };
    for (const kind of Object.keys(make) as ObstacleKind[]) {
      const list: ObstacleView[] = [];
      for (let i = 0; i < POOL_PER_KIND; i++) {
        const view = make[kind]();
        view.group.visible = false;
        this.root.add(view.group);
        list.push(view);
      }
      this.free.set(kind, list);
    }
    for (let i = 0; i < MAX_OBSTACLES; i++) this.slots.push({ id: 0, view: null });
  }

  /** Synchronizuje meshe s prekážkami simulácie; alpha = interpolácia medzi krokmi. */
  sync(sim: GameplaySim, alpha: number, dt: number): void {
    const obstacles = sim.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]!;
      const slot = this.slots[i]!;
      if (!o.active) {
        if (slot.view) this.release(slot);
        continue;
      }
      if (slot.view === null || slot.id !== o.id) {
        if (slot.view) this.release(slot);
        const view = this.free.get(o.kind)!.pop();
        if (!view) continue; // pool vyčerpaný: prekážka sa nezobrazí (nemalo by nastať)
        view.bind(o, sim.eyeHeight);
        view.group.scale.setScalar(1);
        view.group.visible = true;
        slot.view = view;
        slot.id = o.id;
      }
      slot.view.group.position.z = o.prevZ + (o.z - o.prevZ) * alpha;
    }
    this.updateFading(dt);
  }

  /** Prekážka zmizla po zásahu: krátko sa zmenší namiesto okamžitého zmiznutia. */
  fadeOut(id: number): void {
    for (const slot of this.slots) {
      if (slot.id !== id || !slot.view) continue;
      this.fading.push({ view: slot.view, time: FADE_TIME });
      slot.view = null;
      slot.id = 0;
      return;
    }
  }

  /** Nová hra: všetko skryť. */
  clear(): void {
    for (const slot of this.slots) if (slot.view) this.release(slot);
    for (const f of this.fading) this.recycle(f.view);
    this.fading.length = 0;
  }

  private updateFading(dt: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i]!;
      f.time -= dt;
      if (f.time <= 0) {
        this.recycle(f.view);
        this.fading.splice(i, 1);
      } else {
        f.view.group.scale.setScalar(f.time / FADE_TIME);
      }
    }
  }

  private release(slot: Slot): void {
    this.recycle(slot.view!);
    slot.view = null;
    slot.id = 0;
  }

  private recycle(view: ObstacleView): void {
    view.group.visible = false;
    this.free.get(view.kind)!.push(view);
  }
}
