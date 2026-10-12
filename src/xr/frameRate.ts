/**
 * Obnovovacia frekvencia XR session (72 / 90 / 120 Hz na Queste 3).
 *
 * Quest spúšťa WebXR predvolene na 72 Hz. Zmena cez updateTargetFrameRate funguje až počas snímkov
 * (Meta ju v príkladoch volá v XR animation frame); volaná hneď po štarte session sa na Queste nemusí
 * nikdy dokončiť. Preto sa frekvencia žiada v slučke, kým session.frameRate nezodpovedá cieľu
 * (najviac 3 pokusy po 2 s; nedokončený pokus sa po 3 s považuje za neúspešný).
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

export class FrameRateControl {
  /** Želaná frekvencia z nastavení. */
  preferred: number;
  /** Frekvencia, ktorú session hlási, a čo sa žiada (najbližšia podporovaná). */
  current = 0;
  target = 0;
  supported: number[] = [];
  attempts = 0;
  error = '';
  private pending = false;
  private lastAttempt = -Infinity;

  constructor(preferred: number) {
    this.preferred = preferred;
  }

  /** Nová session alebo zmena v nastaveniach: znova sa pokúsi nastaviť frekvenciu. */
  reset(preferred = this.preferred): void {
    this.preferred = preferred;
    this.attempts = 0;
    this.pending = false;
    this.lastAttempt = -Infinity;
    this.error = '';
  }

  /** Volá sa v každom XR snímku. */
  onFrame(session: XRSession, nowMs: number): void {
    this.current = session.frameRate ?? 0;
    const rates = session.supportedFrameRates;
    if (!rates || typeof session.updateTargetFrameRate !== 'function') return;
    if (this.supported.length !== rates.length) this.supported = Array.from(rates);
    this.target = pickFrameRate(rates, this.preferred);
    if (Math.abs(this.current - this.target) < 0.5) return;
    if (this.pending && nowMs - this.lastAttempt > 3000) this.pending = false;
    if (this.pending || this.attempts >= 3 || nowMs - this.lastAttempt < 2000) return;
    this.pending = true;
    this.attempts++;
    this.lastAttempt = nowMs;
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
    return `beží ${Math.round(this.current)} Hz · cieľ ${this.target} Hz · podporované ${this.supported.join('/')} · pokusy ${this.attempts}${extra}`;
  }
}
