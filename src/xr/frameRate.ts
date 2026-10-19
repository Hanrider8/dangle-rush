/**
 * Obnovovacia frekvencia XR session (72 / 90 / 120 Hz na Queste 3).
 *
 * Quest spúšťa WebXR predvolene na 72 Hz. Zmena cez updateTargetFrameRate funguje až počas snímkov
 * (Meta ju v príkladoch volá v XR animation frame); volaná hneď po štarte session sa na Queste nemusí
 * nikdy dokončiť. Preto sa frekvencia žiada v slučke, kým session.frameRate nezodpovedá cieľu
 * (najviac 3 pokusy po 2 s; nedokončený pokus sa po 3 s považuje za neúspešný).
 *
 * Automatický ústup: ak hra frekvenciu nestíha (v okne WINDOW_MS je viac ako LATE_SHARE snímok
 * neskoro), zníži sa na najbližšiu nižšiu podporovanú (120 → 90 → 72) do konca session. Stabilná
 * nižšia frekvencia je pre oči príjemnejšia ako vyššia, ktorá trhá.
 */
export function pickFrameRate(supported: ArrayLike<number>, preferred: number): number {
  let best = -1;
  let min = Infinity;
  for (let i = 0; i < supported.length; i++) {
    const r = supported[i]!;
    if (r < min) min = r;
    if (r <= preferred + 0.5 && r > best) best = r;
  }
  return best > 0 ? best : min;
}

/** Okno merania a podiel neskorých snímok (interval > LATE_FACTOR × cieľ), pri ktorom sa frekvencia zníži. */
const WINDOW_MS = 3000;
const LATE_FACTOR = 1.5;
const LATE_SHARE = 0.05;
/** Po zmene frekvencie sa chvíľu nemeria (prechod, prvé snímky). */
const SETTLE_MS = 2000;
/** Dlhšie medzery (Quest menu, návrat z pozadia) sa nerátajú. */
const GAP_MS = 250;
/** Nižšie ako toto sa automaticky nejde. */
const MIN_AUTO_HZ = 72;

export class FrameRateControl {
  /** Želaná frekvencia z nastavení. */
  preferred: number;
  /** Frekvencia, ktorú session hlási, a čo sa žiada (najbližšia podporovaná). */
  current = 0;
  target = 0;
  supported: number[] = [];
  attempts = 0;
  error = '';
  /** Automatický strop po ústupe (∞ = bez obmedzenia) a z akej frekvencie sa naposledy ustúpilo. */
  cap = Infinity;
  fellBackFrom = 0;
  private pending = false;
  private lastAttempt = -Infinity;
  private lastFrame = -1;
  private windowStart = -1;
  private frames = 0;
  private late = 0;
  private settleUntil = -Infinity;

  constructor(preferred: number) {
    this.preferred = preferred;
  }

  /** Nová session alebo zmena v nastaveniach: znova sa pokúsi nastaviť frekvenciu (aj bez stropu). */
  reset(preferred = this.preferred): void {
    this.preferred = preferred;
    this.attempts = 0;
    this.pending = false;
    this.lastAttempt = -Infinity;
    this.error = '';
    this.cap = Infinity;
    this.fellBackFrom = 0;
    this.lastFrame = -1;
    this.restartWindow(-1);
    this.settleUntil = -Infinity;
  }

  /** Volá sa v každom XR snímku (nowMs = čas snímku z XR). */
  onFrame(session: XRSession, nowMs: number): void {
    this.current = session.frameRate ?? 0;
    this.measure(nowMs);
    const rates = session.supportedFrameRates;
    if (!rates || typeof session.updateTargetFrameRate !== 'function') return;
    if (this.supported.length !== rates.length) this.supported = Array.from(rates);
    this.target = pickFrameRate(rates, Math.min(this.preferred, this.cap));
    if (Math.abs(this.current - this.target) < 0.5) return;
    if (this.pending && nowMs - this.lastAttempt > 3000) this.pending = false;
    if (this.pending || this.attempts >= 3 || nowMs - this.lastAttempt < 2000) return;
    this.pending = true;
    this.attempts++;
    this.lastAttempt = nowMs;
    this.settleUntil = nowMs + SETTLE_MS;
    session.updateTargetFrameRate(this.target).then(
      () => {
        this.pending = false;
      },
      (err: unknown) => {
        this.pending = false;
        this.error = String(err);
      },
    );
  }

  describe(): string {
    if (this.supported.length === 0) return `${Math.round(this.current) || '?'} Hz (frekvencia sa nedá meniť)`;
    const extra = this.error ? ` · chyba: ${this.error}` : '';
    return `beží ${Math.round(this.current)} Hz · cieľ ${this.target} Hz${this.autoNote()} · podporované ${this.supported.join('/')} · pokusy ${this.attempts}${extra}`;
  }

  /** Krátka poznámka o automatickom ústupe (debug overlay). */
  autoNote(): string {
    return this.fellBackFrom > 0 ? ` (auto z ${this.fellBackFrom})` : '';
  }

  /** Meranie neskorých snímok pri ustálenej frekvencii; pri prekročení LATE_SHARE ústup o stupeň nižšie. */
  private measure(nowMs: number): void {
    const prev = this.lastFrame;
    this.lastFrame = nowMs;
    const hz = this.current;
    if (prev < 0 || hz <= 0 || nowMs < this.settleUntil || Math.abs(hz - this.target) > 0.5) {
      this.restartWindow(nowMs);
      return;
    }
    const interval = nowMs - prev;
    if (interval > GAP_MS) {
      this.restartWindow(nowMs);
      return;
    }
    if (this.windowStart < 0) this.windowStart = prev;
    this.frames++;
    if (interval > (LATE_FACTOR * 1000) / hz) this.late++;
    if (nowMs - this.windowStart < WINDOW_MS) return;
    if (this.late > LATE_SHARE * this.frames) this.stepDown(hz, nowMs);
    this.restartWindow(nowMs);
  }

  private stepDown(hz: number, nowMs: number): void {
    let lower = -1;
    for (const r of this.supported) if (r < hz - 0.5 && r >= MIN_AUTO_HZ - 0.5 && r > lower) lower = r;
    if (lower < 0) return;
    this.fellBackFrom = Math.round(hz);
    this.cap = lower;
    // Nový cieľ si vyžiada nové pokusy.
    this.attempts = 0;
    this.lastAttempt = -Infinity;
    this.settleUntil = nowMs + SETTLE_MS;
  }

  private restartWindow(nowMs: number): void {
    this.windowStart = nowMs < 0 ? -1 : nowMs;
    this.frames = 0;
    this.late = 0;
  }
}
