/**
 * Hľadanie farebného puku (zelený biscuit, oranžová loptička) v RGBA obraze.
 *
 * Pixel patrí cieľu podľa odtieňa, sýtosti a jasu (HSV). Súvislé oblasti (4-susednosť) sa zmerajú
 * a vyberie sa najväčšia s rozumným tvarom: nie obrovská plocha ani pretiahnutý pás.
 * Stred je ťažisko oblasti v súradniciach obrazu (stred pixelu i je i + 0,5).
 * Buffre sú predalokované pre danú veľkosť obrazu, detect() nealokuje.
 */
export interface ColorProfile {
  /** Rozsah odtieňa v stupňoch; hueMin > hueMax znamená rozsah cez 0° (červená). */
  hueMin: number;
  hueMax: number;
  /** Najmenšia sýtosť a jas (0–1). */
  satMin: number;
  valMin: number;
}

export interface DetectorLimits {
  minArea: number;
  maxAreaFraction: number;
  minFill: number;
  maxAspect: number;
}

export interface Blob {
  found: boolean;
  /** Ťažisko (px). */
  cx: number;
  cy: number;
  /** Plocha (px) a ohraničujúci obdĺžnik (indexy pixelov). */
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Plocha / plocha obdĺžnika. */
  fill: number;
  /** Počet oblastí, ktoré prešli tvarovými podmienkami. */
  candidates: number;
  /** Počet pixelov farby cieľa v celom obraze. */
  colorPixels: number;
}

/** Patrí farba cieľu? (r, g, b v 0–255) */
export function matchesColor(r: number, g: number, b: number, p: ColorProfile): boolean {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  if (max < p.valMin * 255 || max === 0) return false;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const delta = max - min;
  if (delta === 0 || delta < p.satMin * max) return false;
  let h: number;
  if (max === r) h = (60 * (g - b)) / delta;
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  if (h < 0) h += 360;
  return p.hueMin <= p.hueMax ? h >= p.hueMin && h <= p.hueMax : h >= p.hueMin || h <= p.hueMax;
}

export class BlobDetector {
  /** 0 = pozadie, inak pixel farby cieľa (po detect()). */
  readonly mask: Uint8Array;
  readonly result: Blob = {
    found: false,
    cx: 0,
    cy: 0,
    area: 0,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    fill: 0,
    candidates: 0,
    colorPixels: 0,
  };
  private readonly stack: Int32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.mask = new Uint8Array(width * height);
    this.stack = new Int32Array(width * height);
  }

  detect(rgba: ArrayLike<number>, profile: ColorProfile, limits: DetectorLimits): Blob {
    const w = this.width;
    const h = this.height;
    const n = w * h;
    const mask = this.mask;
    let colorPixels = 0;
    for (let i = 0, k = 0; i < n; i++, k += 4) {
      const hit = matchesColor(rgba[k]!, rgba[k + 1]!, rgba[k + 2]!, profile);
      mask[i] = hit ? 1 : 0;
      if (hit) colorPixels++;
    }

    const r = this.result;
    r.found = false;
    r.candidates = 0;
    r.colorPixels = colorPixels;
    r.area = 0;
    if (colorPixels === 0) return r;

    const maxArea = limits.maxAreaFraction * n;
    const stack = this.stack;
    for (let seed = 0; seed < n; seed++) {
      if (mask[seed] !== 1) continue;
      // Vyplnenie oblasti zásobníkom; navštívené pixely dostanú hodnotu 2.
      mask[seed] = 2;
      let top = 0;
      stack[top++] = seed;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      while (top > 0) {
        const j = stack[--top]!;
        const x = j % w;
        const y = (j - x) / w;
        area++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[j - 1] === 1) {
          mask[j - 1] = 2;
          stack[top++] = j - 1;
        }
        if (x < w - 1 && mask[j + 1] === 1) {
          mask[j + 1] = 2;
          stack[top++] = j + 1;
        }
        if (y > 0 && mask[j - w] === 1) {
          mask[j - w] = 2;
          stack[top++] = j - w;
        }
        if (y < h - 1 && mask[j + w] === 1) {
          mask[j + w] = 2;
          stack[top++] = j + w;
        }
      }
      if (area < limits.minArea || area > maxArea) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const fill = area / (bw * bh);
      const aspect = bw > bh ? bw / bh : bh / bw;
      if (fill < limits.minFill || aspect > limits.maxAspect) continue;
      r.candidates++;
      if (area <= r.area) continue;
      r.found = true;
      r.area = area;
      r.cx = sumX / area + 0.5;
      r.cy = sumY / area + 0.5;
      r.minX = minX;
      r.minY = minY;
      r.maxX = maxX;
      r.maxY = maxY;
      r.fill = fill;
    }
    return r;
  }
}
