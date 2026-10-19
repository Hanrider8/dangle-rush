/**
 * Režim Deker (podľa tréningovej podložky): plocha stojí, na nej sa rozsvieti jedno zo svetiel
 * (config.deker.pads) a hráč cez neho prevedie puk.
 *
 * - Zásah: kamera zachytila puk na svetle až po jeho rozsvietení. Body za zásah rastú s rýchlosťou
 *   (okamžitý zásah až (1 + speedBonus) ×) a s combo násobiteľom, potom sa rozsvieti ďalšie svetlo.
 * - Limit (targetTime podľa obtiažnosti): ak kamera počas svietenia puk videla, je to minutie (combo sa
 *   vynuluje). Bez puku je to len prechod: svetlá sa menia v rytme, body ani combo sa nerátajú.
 * - Kolo trvá roundTime herného času.
 *
 * Krokuje sa len v PLAYING, takže pauza zmrazí všetko. Náhoda ide len z vlastného seedovaného Rng
 * a puk je vstup ako póza hlavy, takže rovnaký seed a rovnaký puk dajú rovnaký priebeh.
 */
import type { Config } from '../config';
import type { EventQueue } from './events';
import { Rng } from './rng';
import { comboMultiplier } from './scoring';
import type { Difficulty } from './settings';
import type { PuckSample } from './types';

/** Odvodenie seedu, aby sa náhoda svetiel nemiešala s náhodou spawnera. */
const SEED_SALT = 0x2c1b3c6d;
const NO_PUCK: PuckSample = { valid: false, x: 0, z: 0, age: 0 };

/** Stav ako obyčajný objekt (testy pauzy a pokračovania, dev nástroje). */
export interface DekerSnapshot {
  time: number;
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  misses: number;
  passes: number;
  reactionSum: number;
  target: number;
  targetAge: number;
  shown: number;
  rngState: number;
}

export class DekerSim {
  readonly padCount: number;
  /** Čistý herný čas kola a jeho dĺžka (s). */
  time = 0;
  duration = 0;
  /** Ako dlho svieti jedno svetlo (podľa obtiažnosti). */
  timeout = 0;
  difficulty: Difficulty = 'easy';
  score = 0;
  combo = 0;
  maxCombo = 0;
  hits = 0;
  /** Limit vypršal, hoci kamera puk videla. */
  misses = 0;
  /** Limit vypršal bez puku (bez kamery). */
  passes = 0;
  /** Súčet časov od rozsvietenia po zásah (priemer = reactionSum / hits). */
  reactionSum = 0;
  /** Index svietiaceho svetla, −1 = medzera medzi svetlami. */
  target = -1;
  /** Ako dlho už svetlo svieti. */
  targetAge = 0;
  /** Počet rozsvietených svetiel. */
  shown = 0;

  private last = -1;
  private gapLeft = 0;
  private sawPuck = false;
  private readonly rng = new Rng(1);

  constructor(
    private readonly cfg: Config,
    private readonly events: EventQueue,
  ) {
    this.padCount = cfg.deker.pads.length;
  }

  reset(seed: number, difficulty: Difficulty): void {
    const d = this.cfg.deker;
    this.difficulty = difficulty;
    this.time = 0;
    this.duration = d.roundTime;
    this.timeout = d.targetTime[difficulty];
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.passes = 0;
    this.reactionSum = 0;
    this.target = -1;
    this.targetAge = 0;
    this.shown = 0;
    this.last = -1;
    this.gapLeft = d.firstDelay;
    this.sawPuck = false;
    this.rng.state = (seed ^ SEED_SALT) >>> 0;
  }

  get finished(): boolean {
    return this.time >= this.duration - 1e-9;
  }

  get timeLeft(): number {
    return Math.max(0, this.duration - this.time);
  }

  get rngState(): number {
    return this.rng.state;
  }

  /** Jeden fixný krok; puck je odhad puku z kamery (neplatný = bez kamery). */
  step(dt: number, puck: PuckSample = NO_PUCK): void {
    if (this.finished) return;
    this.time += dt;
    const usable = puck.valid && puck.age <= this.cfg.puck.maxAge;
    if (this.target < 0) {
      this.gapLeft -= dt;
      if (this.gapLeft <= 1e-9) this.light(usable ? puck : null);
      return;
    }
    this.targetAge += dt;
    if (usable) {
      this.sawPuck = true;
      // Záber spred rozsvietenia sa neráta (kamera vidí puk s oneskorením puck.age).
      const reaction = this.targetAge - puck.age;
      if (reaction >= 0 && this.onPad(this.target, puck.x, puck.z, this.cfg.deker.hitRadius)) {
        this.onHit(reaction);
        return;
      }
    }
    if (this.targetAge >= this.timeout - 1e-9) this.onTimeout();
  }

  snapshot(): DekerSnapshot {
    return {
      time: this.time,
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      hits: this.hits,
      misses: this.misses,
      passes: this.passes,
      reactionSum: this.reactionSum,
      target: this.target,
      targetAge: this.targetAge,
      shown: this.shown,
      rngState: this.rng.state,
    };
  }

  private onPad(i: number, x: number, z: number, radius: number): boolean {
    const p = this.cfg.deker.pads[i]!;
    return Math.hypot(x - p.x, z - p.z) <= radius;
  }

  /** Svetlo smie svietiť: nie predošlé ani to, na ktorom puk práve leží. */
  private allowed(i: number, puck: PuckSample | null): boolean {
    if (i === this.last) return false;
    return !puck || !this.onPad(i, puck.x, puck.z, this.cfg.deker.hitRadius);
  }

  private countAllowed(puck: PuckSample | null): number {
    let n = 0;
    for (let i = 0; i < this.padCount; i++) if (this.allowed(i, puck)) n++;
    return n;
  }

  /** Rozsvieti náhodné povolené svetlo (bez alokácií: k-te povolené v poradí). */
  private light(puck: PuckSample | null): void {
    let candidates = this.countAllowed(puck);
    if (candidates === 0) {
      // Žiadne svetlo by nezostalo (napr. jediné svetlo v configu): rozhodne len predošlé svetlo.
      puck = null;
      candidates = this.countAllowed(null);
    }
    let k = Math.min(candidates - 1, Math.floor(this.rng.next() * candidates));
    let pick = 0;
    for (let i = 0; i < this.padCount; i++) {
      if (!this.allowed(i, puck)) continue;
      if (k-- === 0) {
        pick = i;
        break;
      }
    }
    this.target = pick;
    this.targetAge = 0;
    this.sawPuck = false;
    this.shown++;
    this.events.push('dekerTarget', '', pick);
  }

  private onHit(reaction: number): void {
    const d = this.cfg.deker;
    const speed = Math.max(0, 1 - reaction / this.timeout);
    this.score += Math.round(d.scorePerHit * (1 + d.speedBonus * speed) * comboMultiplier(this.combo, this.cfg.rules));
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.hits++;
    this.reactionSum += reaction;
    this.events.push('dekerHit', '', this.target);
    this.endTarget();
  }

  private onTimeout(): void {
    if (this.sawPuck) {
      this.misses++;
      this.combo = 0;
      this.events.push('dekerMiss', '', this.target);
    } else {
      this.passes++;
      this.events.push('dekerPass', '', this.target);
    }
    this.endTarget();
  }

  private endTarget(): void {
    this.last = this.target;
    this.target = -1;
    this.targetAge = 0;
    this.gapLeft = this.cfg.deker.gapTime;
  }
}
