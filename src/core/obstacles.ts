/**
 * Prekážky a ich kolízne objemy. Súradnice x a y sú v hernom priestore, z je relatívne
 * k čelu prekážky (prekážka sa hýbe po osi z smerom k hráčovi, teda k +z).
 *
 * Prekážky pre telo (obrancovia) sa vyhodnocujú voči guli hlavy. Prekážky na zemi sú len signál
 * pre puk; vzory (slalom, hviezdy, široké miesanie) majú viac prvkov za sebou.
 */
import type { Config } from '../config';
import { clamp } from './math';
import type { BodyKind, FloorKind, ObstacleKind } from './types';

export const MAX_OBSTACLES = 24;
/** Najviac prvkov vo vzore na zemi. */
export const MAX_ELEMENTS = 6;

export class Obstacle {
  active = false;
  id = 0;
  kind: ObstacleKind = 'highBar';
  /** true = prekážka pre telo (vyhodnocuje sa), false = na zemi. */
  body = true;
  /** Poloha čela prekážky (prvého prvku). */
  z = 0;
  prevZ = 0;
  /** Polovičná hĺbka prvku v smere dráhy. */
  halfDepth = 0.05;
  /** Dĺžka vzoru v smere dráhy: od čela po posledný prvok (0 pre jednoduché prekážky). */
  length = 0;
  /** Bočný blok: strana bloku; nízka tyč: strana, z ktorej tyč vychádza. −1 vľavo, +1 vpravo. */
  side = 0;
  /** Medzera: stred a šírka (dvojitý blok, nízka tyč, brána, konečná medzera pohyblivej hokejky). */
  gapX = 0;
  gapW = 0;
  /** Vysoká tyč: spodná hrana; bloky: vrch; prekážky na zemi: výška. */
  height = 0;
  /** Nízka tyč: rozsah tyče v x. */
  x0 = 0;
  x1 = 0;
  /** Prvky vzoru: posun v z voči čelu (0 alebo záporný = ďalej od hráča). */
  readonly elemDz = new Float64Array(MAX_ELEMENTS);
  /** Prvky vzoru: poloha v x (kužeľ, stred brány, hviezda). */
  readonly elemX = new Float64Array(MAX_ELEMENTS);
  /** Prvky vzoru: kadiaľ má ísť puk. */
  readonly elemPuckX = new Float64Array(MAX_ELEMENTS);
  elemCount = 0;
  /** Pohyblivá hokejka: stred tyče na začiatku a na konci presunu a úsek dráhy z0 → z1 presunu. */
  sweepFrom = 0;
  sweepTo = 0;
  sweepZ0 = 0;
  sweepZ1 = 0;
  /** Kolízne kvádre: [minX, minY, minZ, maxX, maxY, maxZ] × boxCount. */
  readonly boxes = new Float64Array(12);
  boxCount = 0;
  /** Už vyhodnotená (prekonaná alebo zásah). */
  resolved = false;
  hit = false;
  /** Poradové číslo vlny (kombinácie majú spoločné). */
  wave = 0;
}

function setBox(
  o: Obstacle,
  i: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const b = o.boxes;
  const k = i * 6;
  b[k] = minX;
  b[k + 1] = minY;
  b[k + 2] = -o.halfDepth;
  b[k + 3] = maxX;
  b[k + 4] = maxY;
  b[k + 5] = o.halfDepth;
}

function reset(o: Obstacle, kind: ObstacleKind, body: boolean, halfDepth: number): void {
  o.kind = kind;
  o.body = body;
  o.halfDepth = halfDepth;
  o.length = 0;
  o.side = 0;
  o.gapX = 0;
  o.gapW = 0;
  o.height = 0;
  o.x0 = 0;
  o.x1 = 0;
  o.elemCount = 0;
  o.sweepFrom = 0;
  o.sweepTo = 0;
  o.sweepZ0 = 0;
  o.sweepZ1 = 0;
  o.boxCount = 0;
}

/** Jeden prvok na čele prekážky (jednoduché prekážky na zemi). */
function singleElement(o: Obstacle, x: number, puckX: number): void {
  o.elemCount = 1;
  o.elemDz[0] = 0;
  o.elemX[0] = x;
  o.elemPuckX[0] = puckX;
}

/** Vysoká tyč cez celú šírku: treba sa zohnúť. Objem siaha až po topY, takže sa nedá preskočiť. */
export function makeHighBar(o: Obstacle, eyeHeight: number, cfg: Config): void {
  const c = cfg.obstacles.highBar;
  reset(o, 'highBar', true, c.thickness / 2);
  o.height = c.heightRatio * eyeHeight;
  o.boxCount = 1;
  setBox(o, 0, -c.width / 2, o.height, c.width / 2, Math.max(c.topY, o.height + 0.5));
}

/** Bočný blok (silueta obrancu) na strane side; treba úkrok alebo náklon na druhú stranu. */
export function makeSideBlock(o: Obstacle, side: number, eyeHeight: number, cfg: Config): void {
  const c = cfg.obstacles.sideBlock;
  reset(o, 'sideBlock', true, c.depth / 2);
  o.side = side < 0 ? -1 : 1;
  o.height = c.topRatio * eyeHeight;
  o.boxCount = 1;
  if (o.side < 0) setBox(o, 0, -c.outerX, 0, c.innerX, o.height);
  else setBox(o, 0, -c.innerX, 0, c.outerX, o.height);
}

/** Dva bloky s medzerou; hlava musí prejsť medzerou. */
export function makeDoubleBlock(o: Obstacle, gapX: number, eyeHeight: number, cfg: Config): void {
  const s = cfg.obstacles.sideBlock;
  const c = cfg.obstacles.doubleBlock;
  reset(o, 'doubleBlock', true, s.depth / 2);
  o.gapX = gapX;
  o.gapW = c.gapWidth;
  o.height = s.topRatio * eyeHeight;
  o.boxCount = 2;
  setBox(o, 0, -s.outerX, 0, gapX - c.gapWidth / 2, o.height);
  setBox(o, 1, gapX + c.gapWidth / 2, 0, s.outerX, o.height);
}

/** Medzera nízkej tyče: tyč vychádza zo strany side a zakryje coverage šírky plochy. */
export function lowBarGap(side: number, coverage: number, cfg: Config): { gapX: number; gapW: number } {
  const w = cfg.playArea.width;
  const covered = coverage * w;
  return { gapX: side < 0 ? covered / 2 : -covered / 2, gapW: w - covered };
}

/** Nízka tyč na zemi; puk treba presunúť do medzery na druhej strane. */
export function makeLowBar(o: Obstacle, side: number, coverage: number, cfg: Config): void {
  const c = cfg.obstacles.lowBar;
  const w = cfg.playArea.width;
  reset(o, 'lowBar', false, c.depth / 2);
  o.side = side < 0 ? -1 : 1;
  const covered = coverage * w;
  if (o.side < 0) {
    o.x0 = -w / 2 - 0.1;
    o.x1 = -w / 2 + covered;
  } else {
    o.x0 = w / 2 - covered;
    o.x1 = w / 2 + 0.1;
  }
  const gap = lowBarGap(o.side, coverage, cfg);
  o.gapX = gap.gapX;
  o.gapW = gap.gapW;
  o.height = c.height;
  singleElement(o, o.gapX, o.gapX);
}

/** Brána z dvoch kužeľov; puk ide medzerou. */
export function makeConeGate(o: Obstacle, gapX: number, cfg: Config): void {
  const c = cfg.obstacles.coneGate;
  reset(o, 'coneGate', false, c.coneRadius);
  o.gapX = gapX;
  o.gapW = c.gapWidth;
  o.height = c.coneHeight;
  singleElement(o, gapX, gapX);
}

/**
 * Slalom: `count` kužeľov v rade na osi centerX, `spacing` metrov za sebou. Puk obchádza prvý
 * kužeľ zo strany firstSide a ďalšie striedavo.
 */
export function makeSlalom(
  o: Obstacle,
  count: number,
  centerX: number,
  firstSide: number,
  spacing: number,
  cfg: Config,
): void {
  const c = cfg.obstacles.slalom;
  reset(o, 'slalom', false, cfg.obstacles.coneGate.coneRadius);
  const n = Math.max(1, Math.min(MAX_ELEMENTS, count));
  let side = firstSide < 0 ? -1 : 1;
  o.side = side;
  for (let i = 0; i < n; i++) {
    o.elemDz[i] = -i * spacing;
    o.elemX[i] = centerX;
    o.elemPuckX[i] = centerX + side * c.passOffset;
    side = -side;
  }
  o.elemCount = n;
  o.length = (n - 1) * spacing;
  o.height = cfg.obstacles.coneGate.coneHeight;
}

/** Hviezdy na zemi v polohách xs, `spacing` metrov za sebou; puk ide cez každú. */
export function makeStars(o: Obstacle, xs: ArrayLike<number>, count: number, spacing: number, cfg: Config): void {
  reset(o, 'stars', false, cfg.obstacles.stars.radius);
  const n = Math.max(1, Math.min(MAX_ELEMENTS, count));
  for (let i = 0; i < n; i++) {
    o.elemDz[i] = -i * spacing;
    o.elemX[i] = xs[i]!;
    o.elemPuckX[i] = xs[i]!;
  }
  o.elemCount = n;
  o.length = (n - 1) * spacing;
}

/** Široké miesanie: brána úplne na strane firstSide a `spacing` metrov za ňou na opačnej strane. */
export function makeWideDangle(o: Obstacle, firstSide: number, spacing: number, cfg: Config): void {
  const c = cfg.obstacles.wideDangle;
  reset(o, 'wideDangle', false, cfg.obstacles.coneGate.coneRadius);
  const side = firstSide < 0 ? -1 : 1;
  o.side = side;
  o.gapW = c.gapWidth;
  o.height = cfg.obstacles.coneGate.coneHeight;
  for (let i = 0; i < 2; i++) {
    const x = (i === 0 ? side : -side) * c.offset;
    o.elemDz[i] = -i * spacing;
    o.elemX[i] = x;
    o.elemPuckX[i] = x;
  }
  o.elemCount = 2;
  o.length = spacing;
}

/**
 * Pohyblivá hokejka obrancu (poke check): tyč na zemi zakrýva coverage šírky plochy. Kým čelo
 * prechádza úsekom z0 → z1, presunie sa zo strany gapSide na opačnú, takže na konci je medzera
 * na strane gapSide.
 */
export function makePokeCheck(
  o: Obstacle,
  gapSide: number,
  coverage: number,
  z0: number,
  z1: number,
  cfg: Config,
): void {
  const w = cfg.playArea.width;
  reset(o, 'pokeCheck', false, cfg.obstacles.lowBar.depth / 2);
  o.side = gapSide < 0 ? -1 : 1;
  const len = coverage * w;
  o.sweepFrom = o.side * (w / 2 - len / 2);
  o.sweepTo = -o.sweepFrom;
  o.sweepZ0 = z0;
  o.sweepZ1 = Math.max(z1, z0 + 1e-3);
  o.gapX = (o.side * len) / 2;
  o.gapW = w - len;
  o.x0 = -len / 2; // rozsah tyče voči jej stredu
  o.x1 = len / 2;
  o.height = cfg.obstacles.lowBar.height;
  singleElement(o, o.gapX, o.gapX);
}

/** Stred pohyblivej hokejky v x, keď je čelo prekážky na z (závisí len od z, pauza ju zmrazí). */
export function pokeCheckCenter(o: Obstacle, z: number): number {
  const t = clamp((z - o.sweepZ0) / (o.sweepZ1 - o.sweepZ0), 0, 1);
  const s = t * t * (3 - 2 * t);
  return o.sweepFrom + (o.sweepTo - o.sweepFrom) * s;
}

/**
 * Kde musí byť stred hlavy (x), aby prekonal prekážku pre telo. Pri vysokej tyči je to kdekoľvek
 * (stačí sa zohnúť). Používa spawner pri pravidlách spravodlivosti.
 */
export function headWindow(
  kind: BodyKind,
  side: number,
  gapX: number,
  cfg: Config,
  out: { lo: number; hi: number },
): void {
  const r = cfg.head.radius;
  const s = cfg.obstacles.sideBlock;
  switch (kind) {
    case 'highBar':
      out.lo = -10;
      out.hi = 10;
      return;
    case 'sideBlock':
      if (side < 0) {
        out.lo = s.innerX + r;
        out.hi = 10;
      } else {
        out.lo = -10;
        out.hi = -(s.innerX + r);
      }
      return;
    case 'doubleBlock': {
      const half = cfg.obstacles.doubleBlock.gapWidth / 2 - r;
      out.lo = gapX - half;
      out.hi = gapX + half;
      return;
    }
  }
}

export function isFloorKind(kind: ObstacleKind): kind is FloorKind {
  return kind !== 'highBar' && kind !== 'sideBlock' && kind !== 'doubleBlock';
}
