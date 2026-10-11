/**
 * Spojitý (swept) test gule hlavy voči prekážkam.
 *
 * V jednom kroku sa hlava aj prekážka posunú. V súradniciach prekážky sa stred hlavy pohne po úsečke
 * A → B; zásah nastane, ak je najmenšia vzdialenosť tejto úsečky od niektorého kvádra ≤ polomer.
 * Vzdialenosť bodu od kvádra je konvexná, takže pozdĺž úsečky stačí 1D minimalizácia (zlatý rez).
 * Bez alokácií: parametre úsečky a kvádra sú v module.
 */
import type { Obstacle } from './obstacles';
import type { Vec3 } from './types';

const INV_PHI = (Math.sqrt(5) - 1) / 2;
const ITERATIONS = 64;

// Úsečka (začiatok a, smer d) a kváder pre distSqAt.
let ax = 0;
let ay = 0;
let az = 0;
let dx = 0;
let dy = 0;
let dz = 0;
let minX = 0;
let minY = 0;
let minZ = 0;
let maxX = 0;
let maxY = 0;
let maxZ = 0;

function axisDistSq(p: number, lo: number, hi: number): number {
  if (p < lo) return (lo - p) * (lo - p);
  if (p > hi) return (p - hi) * (p - hi);
  return 0;
}

function distSqAt(t: number): number {
  return (
    axisDistSq(ax + dx * t, minX, maxX) +
    axisDistSq(ay + dy * t, minY, maxY) +
    axisDistSq(az + dz * t, minZ, maxZ)
  );
}

/** Štvorec vzdialenosti bodu od kvádra. */
export function pointAabbDistSq(
  px: number, py: number, pz: number,
  bMinX: number, bMinY: number, bMinZ: number, bMaxX: number, bMaxY: number, bMaxZ: number,
): number {
  return axisDistSq(px, bMinX, bMaxX) + axisDistSq(py, bMinY, bMaxY) + axisDistSq(pz, bMinZ, bMaxZ);
}

/** Štvorec najmenšej vzdialenosti úsečky (a → b) od kvádra. */
export function segmentAabbDistSq(
  aX: number, aY: number, aZ: number, bX: number, bY: number, bZ: number,
  bMinX: number, bMinY: number, bMinZ: number, bMaxX: number, bMaxY: number, bMaxZ: number,
): number {
  ax = aX; ay = aY; az = aZ;
  dx = bX - aX; dy = bY - aY; dz = bZ - aZ;
  minX = bMinX; minY = bMinY; minZ = bMinZ; maxX = bMaxX; maxY = bMaxY; maxZ = bMaxZ;

  const f0 = distSqAt(0);
  const f1 = distSqAt(1);
  if (f0 === 0 || f1 === 0) return 0;

  let lo = 0;
  let hi = 1;
  let c = hi - INV_PHI * (hi - lo);
  let d = lo + INV_PHI * (hi - lo);
  let fc = distSqAt(c);
  let fd = distSqAt(d);
  for (let i = 0; i < ITERATIONS; i++) {
    if (fc <= fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - INV_PHI * (hi - lo);
      fc = distSqAt(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + INV_PHI * (hi - lo);
      fd = distSqAt(d);
    }
  }
  return Math.min(f0, f1, fc, fd);
}

/**
 * Zasiahne hlava (guľa s polomerom radius) prekážku počas kroku, v ktorom sa stred hlavy pohol
 * z h0 do h1 a prekážka z prevZ do z?
 */
export function sweptHeadHit(o: Obstacle, h0: Vec3, h1: Vec3, radius: number): boolean {
  // Úsečka v súradniciach prekážky: začiatok voči prevZ, koniec voči z.
  const sz = h0.z - o.prevZ;
  const ez = h1.z - o.z;
  const r2 = radius * radius;
  const b = o.boxes;
  for (let i = 0; i < o.boxCount; i++) {
    const k = i * 6;
    // Rýchle vylúčenie podľa z: úsečka je celá pred alebo za kvádrom aj s polomerom.
    if (Math.min(sz, ez) > b[k + 5]! + radius || Math.max(sz, ez) < b[k + 2]! - radius) continue;
    const dist = segmentAabbDistSq(
      h0.x, h0.y, sz, h1.x, h1.y, ez,
      b[k]!, b[k + 1]!, b[k + 2]!, b[k + 3]!, b[k + 4]!, b[k + 5]!,
    );
    if (dist <= r2) return true;
  }
  return false;
}
