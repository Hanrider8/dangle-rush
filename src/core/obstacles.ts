/**
 * Prekážky a ich kolízne objemy. Súradnice x a y sú v hernom priestore, z je relatívne
 * k stredu prekážky (prekážka sa hýbe po osi z smerom k hráčovi, teda k +z).
 *
 * Prekážky pre telo sa vyhodnocujú voči guli hlavy. Prekážky na zemi sú len signál pre loptičku.
 */
import type { Config } from '../config';
import type { BodyKind, FloorKind, ObstacleKind } from './types';

export const MAX_OBSTACLES = 24;

export class Obstacle {
  active = false;
  id = 0;
  kind: ObstacleKind = 'highBar';
  /** true = prekážka pre telo (vyhodnocuje sa), false = na zemi. */
  body = true;
  z = 0;
  prevZ = 0;
  /** Polovičná hĺbka v smere dráhy. */
  halfDepth = 0.05;
  /** Bočný blok: strana bloku; nízka tyč: strana, z ktorej tyč vychádza. −1 vľavo, +1 vpravo. */
  side = 0;
  /** Medzera: stred a šírka (dvojitý blok, nízka tyč, brána). */
  gapX = 0;
  gapW = 0;
  /** Vysoká tyč: spodná hrana; bloky: vrch. */
  height = 0;
  /** Nízka tyč: rozsah tyče v x. */
  x0 = 0;
  x1 = 0;
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
  o.side = 0;
  o.gapX = 0;
  o.gapW = 0;
  o.height = 0;
  o.x0 = 0;
  o.x1 = 0;
  o.boxCount = 0;
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

/** Nízka tyč na zemi; loptičku treba presunúť do medzery na druhej strane. */
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
}

/** Brána z dvoch kužeľov; loptička ide medzerou. */
export function makeConeGate(o: Obstacle, gapX: number, cfg: Config): void {
  const c = cfg.obstacles.coneGate;
  reset(o, 'coneGate', false, c.coneRadius);
  o.gapX = gapX;
  o.gapW = c.gapWidth;
  o.height = c.coneHeight;
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
  return kind === 'lowBar' || kind === 'coneGate';
}
