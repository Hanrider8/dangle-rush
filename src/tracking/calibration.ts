/**
 * Samokalibrácia kamery z nehybného puku na podlahe.
 *
 * Hráč položí puk na zem, pozerá sa naň a krúži hlavou. Puk sa nehýbe, takže so správnou kamerou
 * musia všetky pozorovania (pixel + póza hlavy v čase zachytenia) ukazovať na ten istý bod podlahy.
 * Levenberg–Marquardt hľadá ohniskovú vzdialenosť, stred obrazu, natočenie a polohu kamery voči
 * hlave, oneskorenie kamery a polohu puku tak, aby bola uhlová chyba premietnutia čo najmenšia.
 * Slabé priory držia parametre pri odhade tam, kde ich pohyb hlavy dostatočne neurčí.
 * Beží vo workeri (desiatky ms raz za pár sekúnd), preto tu alokácie nevadia.
 */
import type { Vec3 } from '../core/types';
import { CameraModel, rotateVec, type CamParams, type Pixel } from './cameraModel';
import { createPose, type PoseHistory } from './poseHistory';

export interface CalibConfig {
  minObservations: number;
  minCoverageU: number;
  minCoverageV: number;
  minHeadRangeDeg: number;
  maxRmsDeg: number;
  minInlierRatio: number;
  maxLatencyMs: number;
}

export interface CalibResult {
  ok: boolean;
  /** Prečo sa kalibrácia neprijala (prázdne, ak ok). */
  reason: string;
  params: CamParams;
  /** Poloha puku na podlahe (svet). */
  targetX: number;
  targetZ: number;
  /** Stredná uhlová chyba premietnutia pozorovaní, ktoré zostali. */
  rmsDeg: number;
  observations: number;
  inliers: number;
  coverageU: number;
  coverageV: number;
  headRangeDeg: number;
  iterations: number;
}

/** Parametre: f, cx, cy, rx, ry, rz, tx, ty, tz, latencyMs, poloha puku x, z. */
const NP = 12;
const N_PRIORS = 10;
const MAX_OBS = 300;
/** Šum pozorovania (rad): mierka chýb voči priorom. */
const SIGMA_OBS = 0.003;
const SIGMA_F = 0.35;
/**
 * Stred obrazu býva blízko stredu snímača. Posun stredu a natočenie kamery robia v malom výreze
 * obrazu skoro to isté, preto užší prior: rozdiel vysvetlí radšej natočenie, ktoré platí v celom obraze.
 */
const SIGMA_C = 0.03;
const SIGMA_ROT = 0.35;
const SIGMA_T = 0.025;
const SIGMA_LAT = 80;
/** Kroky numerickej derivácie. */
const STEPS = [0.05, 0.05, 0.05, 1e-5, 1e-5, 1e-5, 1e-5, 1e-5, 1e-5, 0.05, 1e-5, 1e-5];
const DEG = 180 / Math.PI;

function toVector(p: CamParams, tx: number, tz: number): Float64Array {
  return Float64Array.of(p.f, p.cx, p.cy, p.rx, p.ry, p.rz, p.tx, p.ty, p.tz, p.latencyMs, tx, tz);
}

function toParams(x: Float64Array, base: CamParams): CamParams {
  return {
    width: base.width,
    height: base.height,
    f: x[0]!,
    cx: x[1]!,
    cy: x[2]!,
    rx: x[3]!,
    ry: x[4]!,
    rz: x[5]!,
    tx: x[6]!,
    ty: x[7]!,
    tz: x[8]!,
    latencyMs: x[9]!,
  };
}

/** Kvantil zoradeného poľa (lineárne medzi prvkami). */
function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const i = Math.floor(pos);
  const j = Math.min(sorted.length - 1, i + 1);
  return sorted[i]! + (sorted[j]! - sorted[i]!) * (pos - i);
}

/** Riešenie sústavy A x = b Gaussovou elimináciou s výberom pivota (A sa prepíše). */
function solveLinear(a: Float64Array, b: Float64Array, n: number, out: Float64Array): boolean {
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]!) > Math.abs(a[piv * n + c]!)) piv = r;
    if (Math.abs(a[piv * n + c]!) < 1e-300) return false;
    if (piv !== c) {
      for (let k = 0; k < n; k++) {
        const t = a[c * n + k]!;
        a[c * n + k] = a[piv * n + k]!;
        a[piv * n + k] = t;
      }
      const t = b[c]!;
      b[c] = b[piv]!;
      b[piv] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const m = a[r * n + c]! / a[c * n + c]!;
      if (m === 0) continue;
      for (let k = c; k < n; k++) a[r * n + k] = a[r * n + k]! - m * a[c * n + k]!;
      b[r] = b[r]! - m * b[c]!;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= a[r * n + k]! * out[k]!;
    out[r] = s / a[r * n + r]!;
  }
  return true;
}

class Problem {
  readonly n: number;
  readonly active: Uint8Array;
  private readonly cam: CameraModel;
  private readonly pose = createPose();
  private readonly px: Pixel = { u: 0, v: 0 };
  private readonly prior: Float64Array;
  private readonly fNorm: number;

  constructor(
    private readonly t: Float64Array,
    private readonly u: Float64Array,
    private readonly v: Float64Array,
    private readonly poses: PoseHistory,
    private readonly planeY: number,
    private readonly base: CamParams,
    private readonly maxLatency: number,
    prior: Float64Array,
  ) {
    this.n = t.length;
    this.active = new Uint8Array(this.n).fill(1);
    this.cam = new CameraModel(base);
    this.prior = prior;
    this.fNorm = base.f;
  }

  get size(): number {
    return 2 * this.n + N_PRIORS;
  }

  /** Rezíduá (v jednotkách sigma) do `out`; vráti súčet štvorcov. */
  residuals(x: Float64Array, out: Float64Array): number {
    const cam = this.cam;
    cam.setParams(toParams(x, this.base));
    const lat = Math.min(this.maxLatency, Math.max(0, x[9]!));
    const scale = 1 / (this.fNorm * SIGMA_OBS);
    let cost = 0;
    for (let i = 0; i < this.n; i++) {
      let ru = 0;
      let rv = 0;
      if (this.active[i] && this.poses.sample(this.t[i]! - lat, this.pose)) {
        if (cam.project(this.pose, x[10]!, this.planeY, x[11]!, this.px)) {
          ru = (this.px.u - this.u[i]!) * scale;
          rv = (this.px.v - this.v[i]!) * scale;
        } else {
          ru = rv = 1 / SIGMA_OBS;
        }
      }
      out[2 * i] = ru;
      out[2 * i + 1] = rv;
      cost += ru * ru + rv * rv;
    }
    const p = this.prior;
    const b = this.base;
    let k = 2 * this.n;
    const priors = [
      (x[0]! - p[0]!) / (SIGMA_F * p[0]!),
      (x[1]! - p[1]!) / (SIGMA_C * b.width),
      (x[2]! - p[2]!) / (SIGMA_C * b.height),
      (x[3]! - p[3]!) / SIGMA_ROT,
      (x[4]! - p[4]!) / SIGMA_ROT,
      (x[5]! - p[5]!) / SIGMA_ROT,
      (x[6]! - p[6]!) / SIGMA_T,
      (x[7]! - p[7]!) / SIGMA_T,
      (x[8]! - p[8]!) / SIGMA_T,
      (x[9]! - p[9]!) / SIGMA_LAT,
    ];
    for (const r of priors) {
      out[k++] = r;
      cost += r * r;
    }
    return cost;
  }

  /** Uhlová chyba pozorovania i (rad) z rezíduí. */
  errorOf(r: Float64Array, i: number): number {
    return SIGMA_OBS * Math.hypot(r[2 * i]!, r[2 * i + 1]!);
  }
}

/** Levenberg–Marquardt s numerickým Jakobiánom; x sa upraví na mieste. Vráti počet iterácií. */
function levenbergMarquardt(problem: Problem, x: Float64Array, maxIter: number): number {
  const m = problem.size;
  const r = new Float64Array(m);
  const rTry = new Float64Array(m);
  const jac = new Float64Array(m * NP);
  const a = new Float64Array(NP * NP);
  const g = new Float64Array(NP);
  const aDamped = new Float64Array(NP * NP);
  const rhs = new Float64Array(NP);
  const delta = new Float64Array(NP);
  const xTry = new Float64Array(NP);
  let cost = problem.residuals(x, r);
  let lambda = 1e-3;
  let iter = 0;
  for (; iter < maxIter; iter++) {
    for (let k = 0; k < NP; k++) {
      xTry.set(x);
      xTry[k] = xTry[k]! + STEPS[k]!;
      problem.residuals(xTry, rTry);
      for (let i = 0; i < m; i++) jac[i * NP + k] = (rTry[i]! - r[i]!) / STEPS[k]!;
    }
    a.fill(0);
    g.fill(0);
    for (let i = 0; i < m; i++) {
      const ri = r[i]!;
      const row = i * NP;
      for (let p = 0; p < NP; p++) {
        const jp = jac[row + p]!;
        if (jp === 0) continue;
        g[p] = g[p]! + jp * ri;
        for (let q = p; q < NP; q++) a[p * NP + q] = a[p * NP + q]! + jp * jac[row + q]!;
      }
    }
    for (let p = 0; p < NP; p++) for (let q = 0; q < p; q++) a[p * NP + q] = a[q * NP + p]!;

    let improved = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      aDamped.set(a);
      for (let p = 0; p < NP; p++) {
        aDamped[p * NP + p] = a[p * NP + p]! * (1 + lambda) + 1e-12;
        rhs[p] = -g[p]!;
      }
      if (!solveLinear(aDamped, rhs, NP, delta)) {
        lambda *= 10;
        continue;
      }
      for (let p = 0; p < NP; p++) xTry[p] = x[p]! + delta[p]!;
      const costTry = problem.residuals(xTry, rTry);
      if (costTry < cost) {
        const gain = (cost - costTry) / Math.max(cost, 1e-12);
        x.set(xTry);
        r.set(rTry);
        cost = costTry;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = true;
        if (gain < 1e-9) return iter + 1;
        break;
      }
      lambda *= 4;
      if (lambda > 1e10) break;
    }
    if (!improved) break;
  }
  return iter;
}

function fail(reason: string, init: CamParams, partial: Partial<CalibResult> = {}): CalibResult {
  return {
    ok: false,
    reason,
    params: init,
    targetX: NaN,
    targetZ: NaN,
    rmsDeg: NaN,
    observations: 0,
    inliers: 0,
    coverageU: 0,
    coverageV: 0,
    headRangeDeg: 0,
    iterations: 0,
    ...partial,
  };
}

/**
 * Kalibrácia z pozorovaní nehybného puku.
 * @param obsT časy snímok (ms hlavného vlákna, ešte bez odpočítania oneskorenia)
 * @param obsU, obsV stred puku v obraze (px v rozlíšení init.width × init.height)
 * @param poses história pózy hlavy pokrývajúca časy pozorovaní
 * @param init štartovacie parametre (odhad alebo predošlá kalibrácia), zároveň stred priorov
 * @param planeY výška stredu puku nad podlahou
 */
export function calibrateStatic(
  obsT: ArrayLike<number>,
  obsU: ArrayLike<number>,
  obsV: ArrayLike<number>,
  poses: PoseHistory,
  init: CamParams,
  planeY: number,
  cfg: CalibConfig,
): CalibResult {
  // Len pozorovania, ku ktorým existuje póza pre celý povolený rozsah oneskorenia.
  const pose = createPose();
  const keep: number[] = [];
  for (let i = 0; i < obsT.length; i++) {
    const t = obsT[i]!;
    if (
      poses.sample(t, pose) &&
      poses.sample(t - cfg.maxLatencyMs, pose) &&
      poses.sample(t - init.latencyMs, pose)
    ) {
      keep.push(i);
    }
  }
  const stride = Math.max(1, keep.length / MAX_OBS);
  const idx: number[] = [];
  for (let s = 0; s < keep.length; s += stride) idx.push(keep[Math.floor(s)]!);
  const n = idx.length;
  if (n < cfg.minObservations) {
    return fail(`málo pozorovaní (${n}/${cfg.minObservations})`, init, { observations: n });
  }
  const t = new Float64Array(n);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  idx.forEach((k, j) => {
    t[j] = obsT[k]!;
    u[j] = obsU[k]!;
    v[j] = obsV[k]!;
  });

  // Pokrytie obrazu a rozptyl smeru pohľadu.
  const su = Float64Array.from(u).sort();
  const sv = Float64Array.from(v).sort();
  const coverageU = (quantile(su, 0.95) - quantile(su, 0.05)) / init.width;
  const coverageV = (quantile(sv, 0.95) - quantile(sv, 0.05)) / init.height;
  const fwd: Vec3 = { x: 0, y: 0, z: 0 };
  const dirs = new Float64Array(n * 3);
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let j = 0; j < n; j++) {
    poses.sample(t[j]! - init.latencyMs, pose);
    rotateVec(pose.qx, pose.qy, pose.qz, pose.qw, 0, 0, -1, fwd);
    dirs[3 * j] = fwd.x;
    dirs[3 * j + 1] = fwd.y;
    dirs[3 * j + 2] = fwd.z;
    mx += fwd.x;
    my += fwd.y;
    mz += fwd.z;
  }
  const mLen = Math.hypot(mx, my, mz) || 1;
  const angles = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const c = (dirs[3 * j]! * mx + dirs[3 * j + 1]! * my + dirs[3 * j + 2]! * mz) / mLen;
    angles[j] = Math.acos(Math.min(1, Math.max(-1, c))) * DEG;
  }
  angles.sort();
  const headRangeDeg = 2 * quantile(angles, 0.95);
  const stats = { observations: n, coverageU, coverageV, headRangeDeg };
  if (coverageU < cfg.minCoverageU || coverageV < cfg.minCoverageV) {
    return fail('puk sa v obraze málo pohol: krúž hlavou viac', init, stats);
  }
  if (headRangeDeg < cfg.minHeadRangeDeg) return fail('málo pohybu hlavy', init, stats);

  // Štart polohy puku: medián priesečníkov lúčov s podlahou pri štartovacích parametroch.
  const cam = new CameraModel(init);
  const hit: Vec3 = { x: 0, y: 0, z: 0 };
  const xs: number[] = [];
  const zs: number[] = [];
  for (let j = 0; j < n; j++) {
    if (!poses.sample(t[j]! - init.latencyMs, pose)) continue;
    if (cam.pixelToPlane(pose, u[j]!, v[j]!, planeY, hit)) {
      xs.push(hit.x);
      zs.push(hit.z);
    }
  }
  if (xs.length < n / 2) return fail('lúče z kamery nepretínajú podlahu', init, stats);
  const median = (a: number[]) => quantile(Float64Array.from(a).sort(), 0.5);
  const x = toVector(init, median(xs), median(zs));
  const prior = toVector(init, 0, 0);

  const problem = new Problem(t, u, v, poses, planeY, init, cfg.maxLatencyMs, prior);
  let iterations = levenbergMarquardt(problem, x, 40);

  // Odľahlé pozorovania (puk sa pohol, zlá detekcia) sa vyradia a riešenie sa spresní.
  const r = new Float64Array(problem.size);
  problem.residuals(x, r);
  const errs = new Float64Array(n);
  for (let j = 0; j < n; j++) errs[j] = problem.errorOf(r, j);
  const sortedErr = Float64Array.from(errs).sort();
  const threshold = Math.max(3 * quantile(sortedErr, 0.5), 0.0035);
  let inliers = 0;
  for (let j = 0; j < n; j++) {
    problem.active[j] = errs[j]! <= threshold ? 1 : 0;
    inliers += problem.active[j]!;
  }
  iterations += levenbergMarquardt(problem, x, 30);
  problem.residuals(x, r);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (!problem.active[j]) continue;
    const e = problem.errorOf(r, j);
    sum += e * e;
  }
  const rmsDeg = Math.sqrt(sum / Math.max(1, inliers)) * DEG;
  const params = toParams(x, init);
  const result: CalibResult = {
    ok: false,
    reason: '',
    params,
    targetX: x[10]!,
    targetZ: x[11]!,
    rmsDeg,
    inliers,
    iterations,
    ...stats,
  };

  if (inliers < cfg.minInlierRatio * n) result.reason = 'puk sa počas kalibrácie hýbal';
  else if (!(rmsDeg <= cfg.maxRmsDeg)) result.reason = `veľká chyba ${rmsDeg.toFixed(2)}°: puk sa asi hýbal`;
  else if (
    !(params.f > 0.5 * init.f && params.f < 2 * init.f) ||
    !(params.latencyMs >= 0 && params.latencyMs <= cfg.maxLatencyMs) ||
    !(params.cx > 0 && params.cx < init.width && params.cy > 0 && params.cy < init.height)
  ) {
    result.reason = 'nezmyselné parametre kamery';
  } else {
    result.ok = true;
  }
  return result;
}
