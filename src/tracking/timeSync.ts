/**
 * Prevod časových značiek snímok kamery (µs na vlastnej časovej osi) na čas hlavného vlákna (ms).
 *
 * Čas príchodu snímky do JS kolíše (plánovanie workera, dekódovanie), značka zo zachytenia nie.
 * Posun medzi osami je minimum (príchod − značka) za posledné snímky, teda najrýchlejšie doručená
 * snímka. Zvyšné oneskorenie (zachytenie → najrýchlejší príchod) je konštantné a určí ho kalibrácia.
 * Ak značky chýbajú alebo skočia, použije sa čas príchodu.
 */
export class TimeSync {
  private readonly diffs: Float64Array;
  private n = 0;
  private head = 0;
  private lastTs = -Infinity;
  /** Aktuálny posun (príchod − značka) v ms. */
  offset = NaN;
  /** Posledná snímka sa previedla podľa značky (inak podľa príchodu). */
  usingTimestamps = false;
  /** Priemerné oneskorenie doručenia nad najrýchlejšou snímkou (ms). */
  meanExtraDelay = 0;
  /** Koľkokrát sa os značiek zresetovala (skok, pokles značky). */
  resets = 0;

  constructor(window = 90) {
    this.diffs = new Float64Array(window);
  }

  /** Čas snímky v ms hlavného vlákna. */
  map(timestampUs: number, arrivalMs: number): number {
    const ts = timestampUs / 1000;
    if (!Number.isFinite(ts) || ts <= 0) {
      this.usingTimestamps = false;
      return arrivalMs;
    }
    const d = arrivalMs - ts;
    // Pokles značky alebo veľký skok posunu (reštart kamery): začne sa odznova.
    if (ts <= this.lastTs || (this.n > 0 && Math.abs(d - this.offset) > 1000)) {
      this.n = 0;
      this.head = 0;
      this.resets++;
    }
    this.lastTs = ts;
    const cap = this.diffs.length;
    this.diffs[this.head] = d;
    this.head = (this.head + 1) % cap;
    if (this.n < cap) this.n++;
    let min = Infinity;
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      const v = this.diffs[i]!;
      if (v < min) min = v;
      sum += v;
    }
    this.offset = min;
    this.meanExtraDelay = sum / this.n - min;
    this.usingTimestamps = true;
    return ts + min;
  }
}
