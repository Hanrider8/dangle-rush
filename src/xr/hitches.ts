/**
 * Záseky: XR snímok prišiel neskoro (interval > LATE_FACTOR × cieľ). Quest vtedy ukáže predošlý snímok len
 * pootočený podľa hlavy, takže blízke virtuálne veci (podložka, svetlá) pri pohybe na chvíľu odskočia.
 *
 * Ku každému záseku sa zapíše, čo robil predošlý snímok: čas JS v hernej slučke, značky (prekreslená
 * textúra, herná udalosť) a koľko času zabrali správy z kamery medzi snímkami. Debug overlay ukazuje
 * počet zásekov za posledných WINDOW_MS a posledný zásek. Bez alokácií.
 */
export const HITCH_TEXTURE = 1;
export const HITCH_EVENT = 2;

const LATE_FACTOR = 1.5;
/** Dlhšie medzery (Quest menu, návrat z pozadia) nie sú záseky. */
const GAP_MS = 250;
const WINDOW_MS = 10000;
const RING = 64;

export class HitchProbe {
  /** Posledný zásek: interval snímok, JS predošlého snímku, kamera medzi snímkami (ms) a značky. */
  lastInterval = 0;
  lastJs = 0;
  lastCamera = 0;
  lastFlags = 0;
  /** Najdlhší čas JS v slučke za posledné okno (aj bez záseku). */
  maxJs = 0;
  total = 0;
  private readonly times = new Float64Array(RING);
  private head = 0;
  private flags = 0;
  private prevFlags = 0;
  private prevJs = 0;
  private camera = 0;
  private maxJsAt = 0;

  /** Značka pre aktuálny snímok (HITCH_TEXTURE, HITCH_EVENT). */
  mark(flag: number): void {
    this.flags |= flag;
  }

  /** Práca mimo hernej slučky (správy z kamery), ktorá zdržala hlavné vlákno. */
  addCamera(ms: number): void {
    this.camera += ms;
  }

  /** Začiatok XR snímku: interval od predošlého a cieľová dĺžka snímku (ms). */
  beginFrame(nowMs: number, intervalMs: number, targetMs: number): void {
    if (intervalMs > LATE_FACTOR * targetMs && intervalMs < GAP_MS) {
      this.total++;
      this.times[this.head] = nowMs;
      this.head = (this.head + 1) % RING;
      this.lastInterval = intervalMs;
      this.lastJs = this.prevJs;
      this.lastCamera = this.camera;
      this.lastFlags = this.prevFlags;
    }
    this.camera = 0;
    this.flags = 0;
  }

  /** Koniec snímku: čas JS v hernej slučke. */
  endFrame(nowMs: number, jsMs: number): void {
    this.prevJs = jsMs;
    this.prevFlags = this.flags;
    if (jsMs > this.maxJs || nowMs - this.maxJsAt > WINDOW_MS) {
      this.maxJs = jsMs;
      this.maxJsAt = nowMs;
    }
  }

  /** Počet zásekov za posledných WINDOW_MS. */
  recent(nowMs: number): number {
    let n = 0;
    for (let i = 0; i < RING; i++) if (this.times[i]! > 0 && nowMs - this.times[i]! < WINDOW_MS) n++;
    return n;
  }
}
