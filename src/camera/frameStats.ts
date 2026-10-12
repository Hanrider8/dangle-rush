/**
 * Plynulosť XR snímok pre správu testu kamery: priemerné fps, podiel trhnutí (snímka dlhšia ako
 * 1,5 × cieľový interval) a najdlhšia snímka. Priemer fps trhanie neukáže, trhnutia áno.
 */
export class FrameStats {
  frames = 0;
  totalMs = 0;
  hitches = 0;
  worstMs = 0;

  /** Interval medzi dvoma XR snímkami a cieľový interval (ms). Dlhé prestávky (menu, pauza) sa nerátajú. */
  add(intervalMs: number, targetMs: number): void {
    if (!(intervalMs > 0) || intervalMs > 500) return;
    this.frames++;
    this.totalMs += intervalMs;
    if (intervalMs > 1.5 * targetMs) this.hitches++;
    if (intervalMs > this.worstMs) this.worstMs = intervalMs;
  }

  get fps(): number {
    return this.totalMs > 0 ? (this.frames * 1000) / this.totalMs : 0;
  }

  get hitchRate(): number {
    return this.frames > 0 ? this.hitches / this.frames : 0;
  }

  describe(): string {
    if (this.frames === 0) return '–';
    return `${this.fps.toFixed(1)} fps · trhnutia ${(this.hitchRate * 100).toFixed(1)} % (${this.hitches}) · najdlhšia ${this.worstMs.toFixed(0)} ms`;
  }
}
