/**
 * Naučenie farby puku z jednej snímky: hráč ťukne na puk v náhľade kamery.
 *
 * 1. Okolo ťuknutia sa nájde najfarebnejší pixel (najväčšia chróma max − min), to je zárodok.
 *    Musí byť výrazne farebnejší ako väčšina obrazu (podlaha).
 * 2. Z neho rastie súvislá oblasť pixelov s podobným odtieňom a dostatočnou sýtosťou a chrómou.
 *    Oblasť musí mať tvar puku (rovnaké pravidlá ako detektor), inak sa farba rozliala do okolia.
 * 3. Z odtieňov, sýtosti a jasu oblasti sa zostavia kandidáti profilu od voľného po prísny.
 *    Vyberie sa ten, ktorý pokryje najviac oblasti, pritom má farbu len málo pixelov mimo puku
 *    a detektor s ním nájde práve tento puk.
 */
import { BlobDetector, matchesColor, type ColorProfile, type DetectorLimits } from './detector';

export interface LearnOptions {
  /** Polomer hľadania zárodku okolo ťuknutia (podiel šírky obrazu). */
  searchRadius: number;
  /** Najmenšia chróma zárodku (0–1) a o koľko musí prevyšovať medián chrómy obrazu (podlahu). */
  minChroma: number;
  minChromaAboveMedian: number;
  /** Rast oblasti: najväčší rozdiel odtieňa od zárodku (°), najmenšia sýtosť a chróma voči zárodku. */
  growHueDeg: number;
  growSat: number;
  growChroma: number;
  /** Rezerva odtieňa (°) a najmenšia polovičná šírka rozsahu odtieňa. */
  hueMarginDeg: number;
  minHueHalfDeg: number;
  /** Najviac pixelov mimo puku, ktoré smú mať naučenú farbu (podiel obrazu). */
  maxBackground: number;
  /** Najmenšia časť puku, ktorú musí profil pokryť. */
  minCoverage: number;
}

export interface LearnResult {
  ok: boolean;
  /** Prečo sa farba nenaučila (pre hráča). */
  reason: string;
  profile: ColorProfile;
  /** Stred odtieňa (°), dolný decil sýtosti a jasu puku. */
  hue: number;
  sat: number;
  val: number;
  /** Plocha puku (px), aká časť z nej má naučenú farbu a koľko pixelov mimo puku ju má tiež. */
  area: number;
  coverage: number;
  background: number;
  /** Stred nájdeného puku (px). */
  cx: number;
  cy: number;
}

/** Odtieň (°), sýtosť, jas a chróma (0–1) rovnako ako v matchesColor. */
function hsv(r: number, g: number, b: number, out: Float32Array, i: number): void {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = (60 * (g - b)) / delta;
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;
  }
  out[4 * i] = h;
  out[4 * i + 1] = max > 0 ? delta / max : 0;
  out[4 * i + 2] = max / 255;
  out[4 * i + 3] = delta / 255;
}

/** Rozdiel odtieňov so znamienkom v (−180°, 180°]. */
function hueDiff(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

function percentile(sorted: Float32Array | number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

function fail(reason: string, profile: ColorProfile): LearnResult {
  return { ok: false, reason, profile, hue: 0, sat: 0, val: 0, area: 0, coverage: 0, background: 0, cx: 0, cy: 0 };
}

/**
 * Naučí farbu puku, na ktorý hráč ťukol v bode (x, y) (px obrazu).
 * `detector` musí mať rozmery obrazu; jeho maska sa prepíše.
 */
export function learnColor(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  limits: DetectorLimits,
  opts: LearnOptions,
  detector: BlobDetector = new BlobDetector(width, height),
): LearnResult {
  const n = width * height;
  const none: ColorProfile = { hueMin: 0, hueMax: 0, satMin: 1, valMin: 1 };
  const px = new Float32Array(4 * n);
  // Chróma je (max − min) / 255, takže medián sa dá zistiť z histogramu celých čísel 0–255.
  const chromaHist = new Uint32Array(256);
  for (let i = 0, k = 0; i < n; i++, k += 4) {
    hsv(rgba[k]!, rgba[k + 1]!, rgba[k + 2]!, px, i);
    chromaHist[Math.round(px[4 * i + 3]! * 255)]!++;
  }
  let medianChroma = 0;
  for (let c = 0, seen = 0; c < 256; c++) {
    seen += chromaHist[c]!;
    if (seen >= n / 2) {
      medianChroma = c / 255;
      break;
    }
  }

  // 1. Zárodok: najfarebnejší pixel blízko ťuknutia.
  const r = Math.max(2, Math.round(opts.searchRadius * width));
  let seed = -1;
  let seedChroma = 0;
  for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(height - 1, Math.ceil(y + r)); yy++) {
    for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(width - 1, Math.ceil(x + r)); xx++) {
      if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 > r * r) continue;
      const i = yy * width + xx;
      if (px[4 * i + 3]! > seedChroma) {
        seedChroma = px[4 * i + 3]!;
        seed = i;
      }
    }
  }
  if (seed < 0 || seedChroma < Math.max(opts.minChroma, medianChroma + opts.minChromaAboveMedian)) {
    return fail('V mieste ťuknutia nie je farebný puk. Ťukni presne naň.', none);
  }
  const seedHue = px[4 * seed]!;
  const seedSat = px[4 * seed + 1]!;

  // 2. Rast súvislej oblasti s podobnou farbou.
  const inRegion = new Uint8Array(n);
  const stack = new Int32Array(n);
  const maxArea = limits.maxAreaFraction * n;
  let top = 0;
  stack[top++] = seed;
  inRegion[seed] = 1;
  let area = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  const accepts = (j: number) =>
    inRegion[j] === 0 &&
    Math.abs(hueDiff(px[4 * j]!, seedHue)) <= opts.growHueDeg &&
    px[4 * j + 1]! >= opts.growSat * seedSat &&
    px[4 * j + 3]! >= opts.growChroma * seedChroma;
  while (top > 0) {
    const j = stack[--top]!;
    const jx = j % width;
    const jy = (j - jx) / width;
    area++;
    sumX += jx;
    sumY += jy;
    if (jx < minX) minX = jx;
    if (jx > maxX) maxX = jx;
    if (jy < minY) minY = jy;
    if (jy > maxY) maxY = jy;
    if (area > maxArea) return fail('Farba sa rozlieva do okolia. Polož puk na podlahu a ťukni znova.', none);
    if (jx > 0 && accepts(j - 1)) {
      inRegion[j - 1] = 1;
      stack[top++] = j - 1;
    }
    if (jx < width - 1 && accepts(j + 1)) {
      inRegion[j + 1] = 1;
      stack[top++] = j + 1;
    }
    if (jy > 0 && accepts(j - width)) {
      inRegion[j - width] = 1;
      stack[top++] = j - width;
    }
    if (jy < height - 1 && accepts(j + width)) {
      inRegion[j + width] = 1;
      stack[top++] = j + width;
    }
  }
  if (area < limits.minArea) return fail('Puk je v obraze príliš malý. Podíď bližšie a ťukni znova.', none);
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (area / (bw * bh) < limits.minFill || Math.max(bw / bh, bh / bw) > limits.maxAspect) {
    return fail('Ťuknuté miesto nemá tvar puku. Polož puk samostatne na podlahu a ťukni znova.', none);
  }
  const cx = sumX / area + 0.5;
  const cy = sumY / area + 0.5;

  // 3. Štatistika farby puku: stred odtieňa (kruhový priemer), rozptyl odtieňa, dolné decily sýtosti a jasu.
  let sumSin = 0;
  let sumCos = 0;
  for (let i = 0; i < n; i++) {
    if (inRegion[i] === 0) continue;
    const h = (px[4 * i]! * Math.PI) / 180;
    sumSin += Math.sin(h);
    sumCos += Math.cos(h);
  }
  const hueMean = wrapHue((Math.atan2(sumSin, sumCos) * 180) / Math.PI);
  const dh = new Float32Array(area);
  const sat = new Float32Array(area);
  const val = new Float32Array(area);
  for (let i = 0, k = 0; i < n; i++) {
    if (inRegion[i] === 0) continue;
    dh[k] = hueDiff(px[4 * i]!, hueMean);
    sat[k] = px[4 * i + 1]!;
    val[k] = px[4 * i + 2]!;
    k++;
  }
  dh.sort();
  sat.sort();
  val.sort();
  const s10 = percentile(sat, 0.1);
  const v10 = percentile(val, 0.1);

  // Okolo puku (obdĺžnik zväčšený o polovicu) je tieň, ruka a okraj puku zmiešaný s podlahou: pixely tam
  // s naučenou farbou by sa pridali k puku a posunuli jeho stred. Ďalej od puku je pozadie.
  const pad = Math.max(3, Math.round(0.5 * Math.max(bw, bh)));
  const bx0 = minX - pad;
  const bx1 = maxX + pad;
  const by0 = minY - pad;
  const by1 = maxY + pad;
  const maxBackground = opts.maxBackground * n;

  let best: LearnResult | null = null;
  let bestScore = -Infinity;
  const hueBands = [
    [percentile(dh, 0.03), percentile(dh, 0.97), opts.hueMarginDeg, opts.minHueHalfDeg],
    [percentile(dh, 0.1), percentile(dh, 0.9), 0, opts.minHueHalfDeg / 2],
  ] as const;
  for (const [lo, hi, margin, half] of hueBands) {
    for (const f of [0.55, 0.7, 0.85, 1]) {
      const profile: ColorProfile = {
        hueMin: wrapHue(hueMean + Math.min(lo, -half) - margin),
        hueMax: wrapHue(hueMean + Math.max(hi, half) + margin),
        satMin: Math.max(0.12, f * s10),
        valMin: Math.max(0.12, 0.55 * v10),
      };
      let covered = 0;
      let spill = 0;
      let background = 0;
      for (let i = 0, k = 0; i < n; i++, k += 4) {
        if (!matchesColor(rgba[k]!, rgba[k + 1]!, rgba[k + 2]!, profile)) continue;
        if (inRegion[i] === 1) {
          covered++;
          continue;
        }
        const ix = i % width;
        const iy = (i - ix) / width;
        if (ix < bx0 || ix > bx1 || iy < by0 || iy > by1) background++;
        else spill++;
      }
      const coverage = covered / area;
      if (background > maxBackground || coverage < opts.minCoverage) continue;
      // Čo najviac puku a čo najmenej mimo neho; pri zhode vyhrá voľnejší profil (je skôr).
      const score = coverage - (spill + background) / area;
      if (score <= bestScore) continue;
      // Detektor s týmto profilom musí nájsť práve tento puk.
      const blob = detector.detect(rgba, profile, limits);
      if (!blob.found || blob.cx < minX || blob.cx > maxX + 1 || blob.cy < minY || blob.cy > maxY + 1) continue;
      bestScore = score;
      best = { ok: true, reason: '', profile, hue: hueMean, sat: s10, val: v10, area, coverage, background, cx, cy };
    }
  }
  if (!best) {
    return fail('Podlaha alebo okolie má podobnú farbu ako puk, nedá sa spoľahlivo rozlíšiť.', none);
  }
  return best;
}
