/**
 * Syntetizované zvuky cez Web Audio API (žiadne audio súbory).
 * AudioContext vznikne pri geste používateľa (klik na „Spustiť“), inak by ho prehliadač zablokoval.
 * Audio uzly sa vytvárajú len pri udalostiach, nie každý snímok.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  constructor(private readonly volume: number) {}

  /** Volať synchrónne z gesta používateľa. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);
      // 1 s bieleho šumu pre swoosh a buzz.
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
      this.noise = buffer;
    }
    void this.ctx.resume();
  }

  /** Tichý tik počas plnenia dwell; výška tónu rastie s progresom. */
  tick(progress: number): void {
    this.tone(900 + 700 * progress, 0.035, 'triangle', 0.05);
  }

  /** Potvrdenie aktivácie tlačidla: dvojtón nahor. */
  confirm(): void {
    this.tone(660, 0.09, 'sine', 0.25);
    this.tone(990, 0.16, 'sine', 0.25, 0.08);
  }

  /** Pípnutie odpočtu; posledné (štart hry) je vyššie a dlhšie. */
  beep(final = false): void {
    if (final) this.tone(1320, 0.32, 'triangle', 0.3);
    else this.tone(880, 0.12, 'sine', 0.25);
  }

  /** Swoosh pri prekonaní prekážky: šum cez pásmový filter s klesajúcou frekvenciou. */
  swoosh(strength = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(2600, t);
    filter.frequency.exponentialRampToValueAtTime(450, t + 0.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.34);
  }

  /** Buzz pri zásahu: hlboký zubatý tón a krátky šum. */
  buzz(): void {
    this.tone(110, 0.4, 'sawtooth', 0.35, 0, 65);
    this.tone(55, 0.4, 'square', 0.18, 0, 45);
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.27);
  }

  /** Koniec hry: tri klesajúce tóny. */
  gameOver(): void {
    this.tone(523, 0.18, 'triangle', 0.25, 0);
    this.tone(392, 0.18, 'triangle', 0.25, 0.18);
    this.tone(262, 0.42, 'triangle', 0.28, 0.36);
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    peak: number,
    delay = 0,
    freqEnd = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd > 0) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
}
