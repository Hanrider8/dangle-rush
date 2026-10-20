/**
 * História pózy hlavy s časovými značkami: kruhový buffer na typovaných poliach, bez alokácií.
 * Snímka z kamery prichádza s oneskorením, preto sa póza k nej berie z času, keď bola zachytená.
 * Čas je v milisekundách hlavného vlákna (čas XR snímku).
 */
export interface Pose {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export function createPose(): Pose {
  return { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
}

const STRIDE = 7;

/** Uhol medzi orientáciami dvoch póz (stupne, 0–180). */
export function rotationDeg(a: Pose, b: Pose): number {
  const dot = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

export class PoseHistory {
  private readonly times: Float64Array;
  private readonly data: Float64Array;
  /** Fyzický index najstaršej pózy a počet póz. */
  private start = 0;
  private count = 0;

  /**
   * @param capacity koľko póz sa pamätá (pri 90 Hz je 1200 ≈ 13 s)
   * @param maxGapMs medzi dvoma pózami s väčšou medzerou (strata trackingu) sa neinterpoluje
   * @param maxAheadMs o koľko neskorší čas než najnovšia póza ešte vráti najnovšiu pózu
   */
  constructor(
    readonly capacity: number,
    readonly maxGapMs = 100,
    readonly maxAheadMs = 25,
  ) {
    this.times = new Float64Array(capacity);
    this.data = new Float64Array(capacity * STRIDE);
  }

  get size(): number {
    return this.count;
  }

  /** Čas najstaršej a najnovšej pózy (NaN, ak je história prázdna). */
  get oldestTime(): number {
    return this.count > 0 ? this.times[this.start]! : NaN;
  }

  get newestTime(): number {
    return this.count > 0 ? this.times[(this.start + this.count - 1) % this.capacity]! : NaN;
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  /** Pridá pózu. Čas musí rásť; rovnaký alebo starší čas sa ignoruje. */
  push(t: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): void {
    if (this.count > 0 && !(t > this.newestTime)) return;
    let i: number;
    if (this.count < this.capacity) {
      i = (this.start + this.count) % this.capacity;
      this.count++;
    } else {
      i = this.start;
      this.start = (this.start + 1) % this.capacity;
    }
    this.times[i] = t;
    const d = this.data;
    const k = i * STRIDE;
    d[k] = px;
    d[k + 1] = py;
    d[k + 2] = pz;
    d[k + 3] = qx;
    d[k + 4] = qy;
    d[k + 5] = qz;
    d[k + 6] = qw;
  }

  pushPose(t: number, p: Pose): void {
    this.push(t, p.px, p.py, p.pz, p.qx, p.qy, p.qz, p.qw);
  }

  /**
   * Póza v čase t: lineárna interpolácia polohy a normalizovaná interpolácia orientácie.
   * Vráti false, ak je t pred najstaršou pózou, ďaleko za najnovšou alebo v medzere trackingu.
   */
  sample(t: number, out: Pose): boolean {
    const n = this.count;
    if (n === 0 || !(t >= this.times[this.start]!)) return false;
    const cap = this.capacity;
    const last = (this.start + n - 1) % cap;
    if (t >= this.times[last]!) {
      if (t - this.times[last]! > this.maxAheadMs) return false;
      this.copyOut(last, out);
      return true;
    }
    // Binárne hľadanie posledného indexu s časom <= t (logické indexy 0..n-1).
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[(this.start + mid) % cap]! <= t) lo = mid;
      else hi = mid;
    }
    const i0 = (this.start + lo) % cap;
    const i1 = (this.start + hi) % cap;
    const t0 = this.times[i0]!;
    const t1 = this.times[i1]!;
    if (t1 - t0 > this.maxGapMs) return false;
    const a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const d = this.data;
    const k0 = i0 * STRIDE;
    const k1 = i1 * STRIDE;
    out.px = d[k0]! + (d[k1]! - d[k0]!) * a;
    out.py = d[k0 + 1]! + (d[k1 + 1]! - d[k0 + 1]!) * a;
    out.pz = d[k0 + 2]! + (d[k1 + 2]! - d[k0 + 2]!) * a;
    let bx = d[k1 + 3]!;
    let by = d[k1 + 4]!;
    let bz = d[k1 + 5]!;
    let bw = d[k1 + 6]!;
    const ax = d[k0 + 3]!;
    const ay = d[k0 + 4]!;
    const az = d[k0 + 5]!;
    const aw = d[k0 + 6]!;
    // q a −q sú tá istá rotácia: interpoluje sa po kratšej ceste.
    if (ax * bx + ay * by + az * bz + aw * bw < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    const qx = ax + (bx - ax) * a;
    const qy = ay + (by - ay) * a;
    const qz = az + (bz - az) * a;
    const qw = aw + (bw - aw) * a;
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
    out.qx = qx / len;
    out.qy = qy / len;
    out.qz = qz / len;
    out.qw = qw / len;
    return true;
  }

  /** Kópia póz v čase ⟨fromT, toT⟩ od najstaršej (na prenos do workera). */
  exportRange(fromT: number, toT: number): { times: Float64Array; data: Float64Array } {
    const cap = this.capacity;
    let first = -1;
    let n = 0;
    for (let j = 0; j < this.count; j++) {
      const t = this.times[(this.start + j) % cap]!;
      if (t < fromT || t > toT) continue;
      if (first < 0) first = j;
      n++;
    }
    const times = new Float64Array(n);
    const data = new Float64Array(n * STRIDE);
    for (let j = 0; j < n; j++) {
      const i = (this.start + first + j) % cap;
      times[j] = this.times[i]!;
      data.set(this.data.subarray(i * STRIDE, i * STRIDE + STRIDE), j * STRIDE);
    }
    return { times, data };
  }

  /** História z polí, ktoré vyrobil exportRange. */
  static fromArrays(times: Float64Array, data: Float64Array, maxGapMs = 100): PoseHistory {
    const h = new PoseHistory(Math.max(1, times.length), maxGapMs);
    for (let j = 0; j < times.length; j++) {
      const k = j * STRIDE;
      h.push(times[j]!, data[k]!, data[k + 1]!, data[k + 2]!, data[k + 3]!, data[k + 4]!, data[k + 5]!, data[k + 6]!);
    }
    return h;
  }

  private copyOut(i: number, out: Pose): void {
    const d = this.data;
    const k = i * STRIDE;
    out.px = d[k]!;
    out.py = d[k + 1]!;
    out.pz = d[k + 2]!;
    out.qx = d[k + 3]!;
    out.qy = d[k + 4]!;
    out.qz = d[k + 5]!;
    out.qw = d[k + 6]!;
  }
}
