/**
 * Meshe prekážok. Pre každý typ je predalokovaný pool pohľadov, ktoré sa len zapínajú,
 * nastavia podľa prekážky (bind) a posúvajú. Pozícia v z sa interpoluje medzi krokmi simulácie.
 * Voľné pohľady nie sú v scéne: three.js by inak každý snímok prepočítal matice stoviek skrytých meshov.
 * Prvok vzoru na zemi sa skryje hneď, ako ho simulácia posúdi (namiesto neho je efekt z feedback.ts).
 */
import { Group, Mesh, type BufferGeometry, type Material } from 'three';
import type { Config } from '../config';
import { ELEM_PENDING, MAX_ELEMENTS, MAX_OBSTACLES, pokeCheckCenter, type Obstacle } from '../core/obstacles';
import type { GameplaySim } from '../core/sim';
import type { ObstacleKind } from '../core/types';
import { createPlayer, type PlayerGeometry, type Resources } from './materials';

const POOL_PER_KIND = 6;
const FADE_TIME = 0.22;
/** Obídený obranca sa za tento čas „zosunie“ do podlahy. */
const PASS_TIME = 0.35;
const DEFENDER_HEIGHT = 1.75;
/** Pulz navádzania puku: stredná priehľadnosť, amplitúda a frekvencia (Hz). */
const GUIDE_OPACITY = 0.8;
const GUIDE_PULSE = 0.18;
const GUIDE_PULSE_HZ = 0.9;

/** Prvok vzoru ešte nebol posúdený (ani nezmizol po prejdení plochou). */
function pending(o: Obstacle, i: number): boolean {
  return o.elemResult[i] === ELEM_PENDING;
}

interface ObstacleView {
  readonly kind: ObstacleKind;
  readonly group: Group;
  bind(o: Obstacle, eyeHeight: number): void;
  /** Každý snímok: z = interpolovaná poloha čela, time = čas na animácie. */
  update?(o: Obstacle, z: number, time: number): void;
}

function mesh(geometry: BufferGeometry, material: Material, renderOrder = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.renderOrder = renderOrder;
  return m;
}

/** Kváder z jednotkovej geometrie: stred a rozmery. */
function setBox(m: Mesh, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.scale.set(x1 - x0, y1 - y0, z1 - z0);
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
    this.curtain = mesh(g.plane, m.highBarCurtain, 2);
    this.postL = mesh(g.box, m.highBar);
    this.postR = mesh(g.box, m.highBar);
    this.shadow = mesh(g.floorPlane, m.shadow, 3);
    this.group.add(this.shadow, this.postL, this.postR, this.bar, this.curtain);
  }

  bind(o: Obstacle): void {
    const c = this.cfg.obstacles.highBar;
    const y = o.height;
    const t = c.thickness;
    const w = c.width;
    setBox(this.bar, -w / 2, y, -t / 2, w / 2, y + t, t / 2);
    setBox(this.postL, -w / 2 - 0.05, 0, -0.03, -w / 2 + 0.01, y + t, 0.03);
    setBox(this.postR, w / 2 - 0.01, 0, -0.03, w / 2 + 0.05, y + t, 0.03);
    // Slabý „záves“ nad tyčou: hore sa nedá prejsť, treba sa zohnúť.
    this.curtain.position.set(0, y + t + 0.3, 0);
    this.curtain.scale.set(w, 0.6, 1);
    setShadow(this.shadow, 0, w * 0.8, 0.5);
  }
}

/** Obranca (hokejista v drese s číslom) a takmer priesvitná zóna, ktorú treba obísť hlavou. */
class Defender {
  readonly body: Group;
  readonly zone: Mesh;
  readonly shadow: Mesh;

  constructor(r: Resources, geometry: PlayerGeometry, zone: Material) {
    this.body = createPlayer(geometry, r.material.playerMatte, r.material.playerGloss, r.material.numberOpponent);
    this.zone = mesh(r.geometry.box, zone, 2);
    this.shadow = mesh(r.geometry.floorPlane, r.material.shadow, 3);
  }

  addTo(group: Group): void {
    // Kolízna zóna sa nekreslí: pri realistickom hokejistovi pôsobila ako umelý kváder.
    group.add(this.shadow, this.body);
  }

  /** Zóna od x0 po x1, hokejista pri vnútornej hrane (innerX), tvárou k hráčovi, hokejka von. */
  set(x0: number, x1: number, innerX: number, top: number, depth: number): void {
    setBox(this.zone, x0, 0, -depth / 2, x1, top, depth / 2);
    // Helma siaha po vrch kolíznej zóny.
    const scale = Math.max(0.75, Math.min(1.3, top / DEFENDER_HEIGHT));
    const towardOuter = innerX > (x0 + x1) / 2 ? -1 : 1;
    const x = innerX + towardOuter * 0.32 * scale;
    this.body.position.set(x, 0, 0);
    this.body.scale.set(towardOuter * scale, scale, scale);
    setShadow(this.shadow, x + towardOuter * 0.2 * scale, 1.0 * scale, 0.7 * scale);
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
    this.defender = new Defender(r, r.geometry.playerOpponent, r.material.sideBlockZone);
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
    this.left = new Defender(r, r.geometry.playerOpponent, m.doubleBlockZone);
    this.right = new Defender(r, r.geometry.playerOpponent, m.doubleBlockZone);
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
    // Slabé „okno“ vo výške hlavy: tadiaľto musí ísť hlava.
    const y0 = eyeHeight * 0.55;
    const y1 = o.height;
    this.window.position.set(o.gapX, (y0 + y1) / 2, 0);
    this.window.scale.set(o.gapW, y1 - y0, 1);
    setBox(this.edgeL, gl - 0.015, y0, -0.015, gl + 0.015, y1, 0.015);
    setBox(this.edgeR, gr - 0.015, y0, -0.015, gr + 0.015, y1, 0.015);
  }
}

/** Najväčší a najmenší priemer svetelnej škvrny navádzania (m). */
const GUIDE_MAX = 0.45;
const GUIDE_MIN = 0.16;

/** Svetelná škvrna s krúžkom v strede medzery: tadiaľto patrí puk (kruh, nie natiahnutá podľa šírky). */
function setGapStrip(m: Mesh, gapX: number, gapW: number): void {
  const d = Math.max(GUIDE_MIN, Math.min(GUIDE_MAX, gapW * 0.9));
  m.position.set(gapX, 0.008, 0);
  m.scale.set(d, 1, d);
}

/** Nízka prekážka: hokejka ležiaca na zemi z jednej strany. */
class LowBarView implements ObstacleView {
  readonly kind = 'lowBar' as const;
  readonly group = new Group();
  private readonly bar: Mesh;
  private readonly strip: Mesh;
  private readonly shadow: Mesh;

  constructor(r: Resources) {
    const g = r.geometry;
    const m = r.material;
    this.bar = mesh(g.stick, m.lowBar);
    this.strip = mesh(g.floorPlane, m.guide, 3);
    this.shadow = mesh(g.floorPlane, m.shadow, 2);
    this.group.add(this.shadow, this.strip, this.bar);
  }

  bind(o: Obstacle): void {
    const len = o.x1 - o.x0;
    const center = (o.x0 + o.x1) / 2;
    // Hokejka leží na zemi, čepeľ smeruje k medzere (stred plochy).
    this.bar.position.set(center, 0, 0);
    this.bar.scale.set((center < 0 ? 1 : -1) * len, 1, 1);
    setGapStrip(this.strip, o.gapX, o.gapW);
    setShadow(this.shadow, (o.x0 + o.x1) / 2, len * 1.05, 0.2);
  }

  update(o: Obstacle): void {
    this.group.visible = pending(o, 0);
  }
}

class ConeGateView implements ObstacleView {
  readonly kind = 'coneGate' as const;
  readonly group = new Group();
  private readonly cones: ConeMeshes[] = [];
  private readonly strip: Mesh;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    this.strip = mesh(r.geometry.floorPlane, r.material.guide, 3);
    this.group.add(this.strip);
    for (let i = 0; i < 2; i++) this.cones.push(new ConeMeshes(r, this.group));
  }

  bind(o: Obstacle): void {
    const c = this.cfg.obstacles.coneGate;
    for (let i = 0; i < 2; i++) {
      this.cones[i]!.set(o.gapX + (i === 0 ? -1 : 1) * (o.gapW / 2 + c.coneRadius), 0, this.cfg);
    }
    setGapStrip(this.strip, o.gapX, o.gapW);
  }

  update(o: Obstacle): void {
    this.group.visible = pending(o, 0);
  }
}

/** Prvok vzoru je vidieť, až keď sa dostane na koniec dráhy (ďalej za ňou by „visel vo vzduchu“). */
function elementVisible(z: number, dz: number, spawnDistance: number): boolean {
  return z + dz >= -spawnDistance - 0.05;
}

/** Kužeľ s blob tieňom. */
class ConeMeshes {
  readonly cone: Mesh;
  readonly shadow: Mesh;

  constructor(r: Resources, group: Group) {
    this.shadow = mesh(r.geometry.floorPlane, r.material.shadow, 2);
    this.cone = mesh(r.geometry.cone, r.material.cone);
    group.add(this.shadow, this.cone);
  }

  set(x: number, z: number, cfg: Config): void {
    const c = cfg.obstacles.coneGate;
    this.cone.position.set(x, 0, z);
    this.cone.scale.set(c.coneRadius, c.coneHeight, c.coneRadius);
    this.shadow.position.set(x, 0.006, z);
    this.shadow.scale.set(c.coneRadius * 4, 1, c.coneRadius * 4);
  }

  setVisible(visible: boolean): void {
    this.cone.visible = visible;
    this.shadow.visible = visible;
  }
}

/** Slalom: kužele v rade, pri každom zelená značka na strane, kadiaľ ide puk. */
class SlalomView implements ObstacleView {
  readonly kind = 'slalom' as const;
  readonly group = new Group();
  private readonly cones: ConeMeshes[] = [];
  private readonly marks: Mesh[] = [];
  private count = 0;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    for (let i = 0; i < MAX_ELEMENTS; i++) {
      this.cones.push(new ConeMeshes(r, this.group));
      const mark = mesh(r.geometry.floorPlane, r.material.guide, 3);
      this.marks.push(mark);
      this.group.add(mark);
    }
  }

  bind(o: Obstacle): void {
    const pass = this.cfg.obstacles.slalom.passOffset;
    this.count = o.elemCount;
    for (let i = 0; i < MAX_ELEMENTS; i++) {
      const used = i < o.elemCount;
      this.cones[i]!.setVisible(used);
      this.marks[i]!.visible = used;
      if (!used) continue;
      this.cones[i]!.set(o.elemX[i]!, o.elemDz[i]!, this.cfg);
      // Svetelná škvrna na stope puku vedľa kužeľa (strana, kadiaľ ho obísť).
      this.marks[i]!.position.set(o.elemPuckX[i]!, 0.008, o.elemDz[i]!);
      this.marks[i]!.scale.set(pass * 1.2, 1, pass * 1.2);
    }
  }

  update(o: Obstacle, z: number): void {
    const d = this.cfg.obstacles.spawnDistance;
    for (let i = 0; i < this.count; i++) {
      const visible = pending(o, i) && elementVisible(z, o.elemDz[i]!, d);
      this.cones[i]!.setVisible(visible);
      this.marks[i]!.visible = visible;
    }
  }
}

/** Široké miesanie: dve brány z kužeľov, úplne na jednej strane a potom na druhej. */
class WideDangleView implements ObstacleView {
  readonly kind = 'wideDangle' as const;
  readonly group = new Group();
  private readonly cones: ConeMeshes[] = [];
  private readonly strips: Mesh[] = [];

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    for (let i = 0; i < 4; i++) this.cones.push(new ConeMeshes(r, this.group));
    for (let i = 0; i < 2; i++) {
      const strip = mesh(r.geometry.floorPlane, r.material.guide, 3);
      this.strips.push(strip);
      this.group.add(strip);
    }
  }

  bind(o: Obstacle): void {
    const r = this.cfg.obstacles.coneGate.coneRadius;
    for (let g = 0; g < 2; g++) {
      const x = o.elemX[g]!;
      const dz = o.elemDz[g]!;
      this.cones[g * 2]!.set(x - o.gapW / 2 - r, dz, this.cfg);
      this.cones[g * 2 + 1]!.set(x + o.gapW / 2 + r, dz, this.cfg);
      setGapStrip(this.strips[g]!, x, o.gapW);
      this.strips[g]!.position.z = dz;
    }
  }

  update(o: Obstacle, z: number): void {
    const d = this.cfg.obstacles.spawnDistance;
    for (let g = 0; g < 2; g++) {
      const visible = pending(o, g) && elementVisible(z, o.elemDz[g]!, d);
      this.cones[g * 2]!.setVisible(visible);
      this.cones[g * 2 + 1]!.setVisible(visible);
      this.strips[g]!.visible = visible;
    }
  }
}

/** „Hviezdy“: puky na červených bodoch buly, cez ktoré prevedieš svoj puk. */
class StarsView implements ObstacleView {
  readonly kind = 'stars' as const;
  readonly group = new Group();
  private readonly spots: Mesh[] = [];
  private readonly pucks: Mesh[] = [];
  private count = 0;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    for (let i = 0; i < MAX_ELEMENTS; i++) {
      const spot = mesh(r.geometry.star, r.material.star, 3);
      const puck = mesh(r.geometry.puck, r.material.puck);
      this.spots.push(spot);
      this.pucks.push(puck);
      this.group.add(spot, puck);
    }
  }

  bind(o: Obstacle): void {
    const radius = this.cfg.obstacles.stars.radius;
    this.count = o.elemCount;
    for (let i = 0; i < MAX_ELEMENTS; i++) {
      const used = i < o.elemCount;
      this.spots[i]!.visible = used;
      this.pucks[i]!.visible = used;
      if (!used) continue;
      this.spots[i]!.position.set(o.elemX[i]!, 0.006, o.elemDz[i]!);
      this.spots[i]!.scale.setScalar(radius);
      this.pucks[i]!.position.set(o.elemX[i]!, 0.007, o.elemDz[i]!);
      this.pucks[i]!.rotation.y = i * 1.3;
    }
  }

  update(o: Obstacle, z: number): void {
    const d = this.cfg.obstacles.spawnDistance;
    for (let i = 0; i < this.count; i++) {
      const visible = pending(o, i) && elementVisible(z, o.elemDz[i]!, d);
      this.spots[i]!.visible = visible;
      this.pucks[i]!.visible = visible;
    }
  }
}

/** Pohyblivá hokejka obrancu: leží na zemi a posúva sa na druhú stranu; medzera sa otvára. */
class PokeCheckView implements ObstacleView {
  readonly kind = 'pokeCheck' as const;
  readonly group = new Group();
  private readonly stick: Mesh;
  private readonly strip: Mesh;
  private readonly shadow: Mesh;
  private len = 1;

  constructor(
    r: Resources,
    private readonly cfg: Config,
  ) {
    const g = r.geometry;
    const m = r.material;
    this.shadow = mesh(g.floorPlane, m.shadow, 2);
    this.strip = mesh(g.floorPlane, m.guide, 3);
    this.stick = mesh(g.stick, m.stick);
    this.group.add(this.shadow, this.strip, this.stick);
  }

  bind(o: Obstacle): void {
    this.len = o.x1 - o.x0;
    // Čepeľ vpredu v smere presunu (na strane opačnej ako konečná medzera).
    this.stick.scale.set(-o.side * this.len, 1, 1);
    this.shadow.scale.set(this.len * 1.05, 1, 0.22);
  }

  update(o: Obstacle, z: number): void {
    this.group.visible = pending(o, 0);
    const cx = pokeCheckCenter(o, z);
    const half = this.len / 2;
    this.stick.position.set(cx, 0, 0);
    this.shadow.position.set(cx, 0.006, 0);
    // Medzera na strane, kde bude na konci: postupne sa otvára.
    const w = this.cfg.playArea.width / 2;
    const edge = cx + o.side * half;
    const width = o.side > 0 ? w - edge : edge + w;
    this.strip.visible = width > 0.06;
    if (this.strip.visible) setGapStrip(this.strip, (edge + o.side * w) / 2, width + 0.04);
  }
}

interface Slot {
  id: number;
  view: ObstacleView | null;
  /** Obídený obranca: prekážka je ešte aktívna, ale už sa nezobrazuje. */
  dismissed: boolean;
}

interface Fading {
  view: ObstacleView;
  time: number;
  duration: number;
  /** shrink = zásah (zmenší sa celá), sink = obídený obranca (zosunie sa do podlahy). */
  mode: 'shrink' | 'sink';
}

export class ObstacleViews {
  readonly root = new Group();
  private readonly free = new Map<ObstacleKind, ObstacleView[]>();
  private readonly slots: Slot[] = [];
  private readonly fading: Fading[] = [];
  private time = 0;
  /** Zdieľaný materiál navádzania puku: pomaly pulzuje (jedna zmena za snímok pre všetky škvrny). */
  private readonly guide: Material & { opacity: number };

  constructor(resources: Resources, cfg: Config) {
    this.guide = resources.material.guide;
    const make: Record<ObstacleKind, () => ObstacleView> = {
      highBar: () => new HighBarView(resources, cfg),
      sideBlock: () => new SideBlockView(resources, cfg),
      doubleBlock: () => new DoubleBlockView(resources, cfg),
      lowBar: () => new LowBarView(resources),
      coneGate: () => new ConeGateView(resources, cfg),
      slalom: () => new SlalomView(resources, cfg),
      stars: () => new StarsView(resources, cfg),
      wideDangle: () => new WideDangleView(resources, cfg),
      pokeCheck: () => new PokeCheckView(resources, cfg),
    };
    for (const kind of Object.keys(make) as ObstacleKind[]) {
      const list: ObstacleView[] = [];
      for (let i = 0; i < POOL_PER_KIND; i++) {
        const view = make[kind]();
        view.group.visible = false;
        list.push(view);
      }
      this.free.set(kind, list);
    }
    for (let i = 0; i < MAX_OBSTACLES; i++) this.slots.push({ id: 0, view: null, dismissed: false });
  }

  /** Synchronizuje meshe s prekážkami simulácie; alpha = interpolácia medzi krokmi. */
  sync(sim: GameplaySim, alpha: number, dt: number): void {
    this.time += dt;
    this.guide.opacity = GUIDE_OPACITY + GUIDE_PULSE * Math.sin(this.time * GUIDE_PULSE_HZ * 2 * Math.PI);
    const obstacles = sim.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]!;
      const slot = this.slots[i]!;
      if (!o.active) {
        if (slot.view) this.release(slot);
        slot.id = 0;
        slot.dismissed = false;
        continue;
      }
      if (slot.dismissed && slot.id === o.id) continue;
      if (slot.view === null || slot.id !== o.id) {
        slot.dismissed = false;
        if (slot.view) this.release(slot);
        const view = this.free.get(o.kind)!.pop();
        if (!view) continue; // pool vyčerpaný: prekážka sa nezobrazí (nemalo by nastať)
        view.bind(o, sim.eyeHeight);
        view.group.scale.setScalar(1);
        view.group.visible = true;
        this.root.add(view.group);
        slot.view = view;
        slot.id = o.id;
      }
      const z = o.prevZ + (o.z - o.prevZ) * alpha;
      slot.view.group.position.z = z;
      slot.view.update?.(o, z, this.time);
    }
    this.updateFading(dt);
  }

  /** Prekážka zmizla po zásahu: krátko sa zmenší namiesto okamžitého zmiznutia. */
  fadeOut(id: number): void {
    for (const slot of this.slots) {
      if (slot.id !== id || !slot.view) continue;
      this.fading.push({ view: slot.view, time: FADE_TIME, duration: FADE_TIME, mode: 'shrink' });
      slot.view = null;
      slot.id = 0;
      return;
    }
  }

  /** Obídený obranca: zosunie sa do podlahy a už sa neukáže (prekážka ešte chvíľu žije v simulácii). */
  passOut(id: number): void {
    for (const slot of this.slots) {
      if (slot.id !== id || !slot.view) continue;
      this.fading.push({ view: slot.view, time: PASS_TIME, duration: PASS_TIME, mode: 'sink' });
      slot.view = null;
      slot.dismissed = true;
      return;
    }
  }

  /** Nová hra: všetko skryť. */
  clear(): void {
    for (const slot of this.slots) {
      if (slot.view) this.release(slot);
      slot.dismissed = false;
    }
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
      } else if (f.mode === 'sink') {
        const k = f.time / f.duration;
        f.view.group.scale.set(1, k * k, 1);
      } else {
        f.view.group.scale.setScalar(f.time / f.duration);
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
    this.root.remove(view.group);
    this.free.get(view.kind)!.push(view);
  }

  /**
   * Na predkompiláciu shaderov: dočasne pridá do scény jeden pohľad každého typu, zavolá fn
   * a znova ich odoberie (pohľady sú skryté, fn ich má zviditeľniť).
   */
  withAllKinds(fn: () => void): void {
    const added: ObstacleView[] = [];
    for (const list of this.free.values()) {
      const view = list[list.length - 1];
      if (!view) continue;
      this.root.add(view.group);
      added.push(view);
    }
    fn();
    for (const view of added) {
      view.group.visible = false;
      this.root.remove(view.group);
    }
  }
}
