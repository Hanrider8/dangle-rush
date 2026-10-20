/**
 * Režim Deker (podľa tréningovej podložky): plocha stojí, na nej sa na náhodnom mieste rozsvieti svetlo
 * a hráč cez neho prevedie puk.
 *
 * - Svetlo: náhodne na podložke (config.deker.mat bez edgeMargin pri okraji), aspoň minJump od predošlého
 *   svetla aj od puku, takže puk treba vždy presunúť.
 * - Zásah: kamera zachytila puk na svetle (do polomeru cieľa + hitTolerance) až po jeho rozsvietení.
 *   Body za zásah rastú s rýchlosťou (okamžitý zásah až (1 + speedBonus) ×), s combo násobiteľom a pri
 *   menšom cieli (targetSizes), potom sa rozsvieti ďalšie svetlo.
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
import type { DekerSize, Difficulty } from './settings';
import type { PuckSample } from './types';

/** Odvodenie seedu, aby sa náhoda svetiel nemiešala s náhodou spawnera. */
const SEED_SALT = 0x2c1b3c6d;
const NO_PUCK: PuckSample = { valid: false, x: 0, z: 0, age: 0 };
/** Koľko náhodných miest sa skúsi, kým sa nájde dosť vzdialené (potom rohy, nakoniec najvzdialenejšie). */
const MAX_TRIES = 32;

/**
 * Ladenie sledovania: svetlá v jednej zóne (blízko / ďaleko od hráča). Pri každom svetle sa zapíše, ako
 * najbližšie sa k jeho stredu dostal puk podľa kamery (len zábery po rozsvietení) a kam bol vtedy posunutý.
 */
export class DekerZoneStats {
  lights = 0;
  hits = 0;
  /** Svetlá, pri ktorých kamera puk videla. */
  seen = 0;
  /** Súčet najmenších vzdialeností puku od stredu svetla a posunu puku v tej chvíli (len videné, m). */
  minSum = 0;
  dxSum = 0;
  dzSum = 0;

  reset(): void {
    this.lights = 0;
    this.hits = 0;
    this.seen = 0;
    this.minSum = 0;
    this.dxSum = 0;
    this.dzSum = 0;
  }

  copy(): DekerZoneStats {
    const c = new DekerZoneStats();
    Object.assign(c, this);
    return c;
  }
}

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
  lit: boolean;
  targetX: number;
  targetZ: number;
  targetAge: number;
  shown: number;
  rngState: number;
  near: DekerZoneStats;
  far: DekerZoneStats;
}

export class DekerSim {
  /** Kde sa smie rozsvietiť stred svetla (herný priestor). */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Čistý herný čas kola a jeho dĺžka (s). */
  time = 0;
  duration = 0;
  /** Ako dlho svieti jedno svetlo (podľa obtiažnosti). */
  timeout = 0;
  difficulty: Difficulty = 'easy';
  size: DekerSize = 'medium';
  /** Polomer svetla (render), polomer zásahu a násobok bodov podľa veľkosti cieľa. */
  radius = 0;
  hitRadius = 0;
  sizeScore = 1;
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
  /** Svieti svetlo (inak je medzera medzi svetlami) a kde. */
  lit = false;
  targetX = 0;
  targetZ = 0;
  /** Ako dlho už svetlo svieti. */
  targetAge = 0;
  /** Počet rozsvietených svetiel (n v udalostiach). */
  shown = 0;
  /**
   * Posledné posúdené svetlo (zásah, minutie alebo prechod): render pri udalosti ukáže záblesk na tomto
   * mieste. Ďalšie svetlo sa rozsvieti až po gapTime, takže pri vyprázdnení udalostí ešte platí.
   */
  lastX = 0;
  lastZ = 0;
  /** Ladenie sledovania: svetlá blízko a ďaleko (config.deker.farDistance) od hráča. */
  readonly near = new DekerZoneStats();
  readonly far = new DekerZoneStats();

  private hasLast = false;
  /** Najbližší puk k svietiacemu svetlu (vzdialenosť a posun). */
  private minDist = Infinity;
  private minDx = 0;
  private minDz = 0;
  private gapLeft = 0;
  private sawPuck = false;
  private readonly rng = new Rng(1);

  constructor(
    private readonly cfg: Config,
    private readonly events: EventQueue,
  ) {
    const d = cfg.deker;
    const halfW = d.mat.width / 2 - d.edgeMargin;
    const halfD = d.mat.depth / 2 - d.edgeMargin;
    this.minX = -halfW;
    this.maxX = halfW;
    this.minZ = -d.mat.centerDistance - halfD;
    this.maxZ = -d.mat.centerDistance + halfD;
  }

  reset(seed: number, difficulty: Difficulty, size: DekerSize = 'large'): void {
    const d = this.cfg.deker;
    const t = d.targetSizes[size];
    this.difficulty = difficulty;
    this.size = size;
    this.radius = t.radius;
    this.hitRadius = t.radius + d.hitTolerance;
    this.sizeScore = t.score;
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
    this.lit = false;
    this.targetX = 0;
    this.targetZ = 0;
    this.targetAge = 0;
    this.shown = 0;
    this.lastX = 0;
    this.lastZ = 0;
    this.hasLast = false;
    this.gapLeft = d.firstDelay;
    this.sawPuck = false;
    this.minDist = Infinity;
    this.near.reset();
    this.far.reset();
    this.rng.state = (seed ^ SEED_SALT) >>> 0;
  }

  get finished(): boolean {
    return this.time >= this.duration - 1e-9;
  }

  get timeLeft(): number {
    return Math.max(0, this.duration - this.time);
  }

  /** Jeden fixný krok; puck je odhad puku z kamery (neplatný = bez kamery). */
  step(dt: number, puck: PuckSample = NO_PUCK): void {
    if (this.finished) return;
    this.time += dt;
    const usable = puck.valid && puck.age <= this.cfg.puck.maxAge;
    if (!this.lit) {
      this.gapLeft -= dt;
      if (this.gapLeft <= 1e-9) this.light(usable ? puck : null);
      return;
    }
    this.targetAge += dt;
    if (usable) {
      this.sawPuck = true;
      // Záber spred rozsvietenia sa neráta (kamera vidí puk s oneskorením puck.age).
      const reaction = this.targetAge - puck.age;
      if (reaction >= 0) {
        const dx = puck.x - this.targetX;
        const dz = puck.z - this.targetZ;
        const dist = Math.hypot(dx, dz);
        if (dist < this.minDist) {
          this.minDist = dist;
          this.minDx = dx;
          this.minDz = dz;
        }
        if (dist <= this.hitRadius) {
          this.onHit(reaction);
          return;
        }
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
      lit: this.lit,
      targetX: this.targetX,
      targetZ: this.targetZ,
      targetAge: this.targetAge,
      shown: this.shown,
      rngState: this.rng.state,
      near: this.near.copy(),
      far: this.far.copy(),
    };
  }

  /** Vzdialenosť miesta od predošlého svetla a od puku (menšia z nich; ∞, ak nie je ani jedno). */
  private clearance(x: number, z: number, puck: PuckSample | null): number {
    let c = Infinity;
    if (this.hasLast) c = Math.hypot(x - this.lastX, z - this.lastZ);
    if (puck) c = Math.min(c, Math.hypot(x - puck.x, z - puck.z));
    return c;
  }

  /** Rozsvieti svetlo na náhodnom mieste aspoň minJump od predošlého a od puku (bez alokácií). */
  private light(puck: PuckSample | null): void {
    let bestX = 0;
    let bestZ = 0;
    let best = -1;
    for (let i = 0; i < MAX_TRIES; i++) {
      const x = this.rng.range(this.minX, this.maxX);
      const z = this.rng.range(this.minZ, this.maxZ);
      const c = this.clearance(x, z, puck);
      if (c > best) {
        best = c;
        bestX = x;
        bestZ = z;
      }
      if (c >= this.cfg.deker.minJump) break;
    }
    // Náhoda nenašla dosť vzdialené miesto (puk aj predošlé svetlo v strede): najvzdialenejší roh.
    if (best < this.cfg.deker.minJump) {
      for (let k = 0; k < 4; k++) {
        const x = k & 1 ? this.maxX : this.minX;
        const z = k & 2 ? this.maxZ : this.minZ;
        const c = this.clearance(x, z, puck);
        if (c > best) {
          best = c;
          bestX = x;
          bestZ = z;
        }
      }
    }
    this.lit = true;
    this.targetX = bestX;
    this.targetZ = bestZ;
    this.targetAge = 0;
    this.sawPuck = false;
    this.minDist = Infinity;
    this.shown++;
    this.events.push('dekerTarget', '', this.shown);
  }

  private onHit(reaction: number): void {
    const d = this.cfg.deker;
    const speed = Math.max(0, 1 - reaction / this.timeout);
    const multiplier = comboMultiplier(this.combo, this.cfg.rules) * this.sizeScore;
    this.score += Math.round(d.scorePerHit * (1 + d.speedBonus * speed) * multiplier);
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.hits++;
    this.reactionSum += reaction;
    this.endTarget(true);
    this.events.push('dekerHit', '', this.shown);
  }

  private onTimeout(): void {
    const missed = this.sawPuck;
    if (missed) {
      this.misses++;
      this.combo = 0;
    } else {
      this.passes++;
    }
    this.endTarget(false);
    this.events.push(missed ? 'dekerMiss' : 'dekerPass', '', this.shown);
  }

  private endTarget(hit: boolean): void {
    const zone = Math.hypot(this.targetX, this.targetZ) >= this.cfg.deker.farDistance ? this.far : this.near;
    zone.lights++;
    if (hit) zone.hits++;
    if (this.minDist < Infinity) {
      zone.seen++;
      zone.minSum += this.minDist;
      zone.dxSum += this.minDx;
      zone.dzSum += this.minDz;
    }
    this.lastX = this.targetX;
    this.lastZ = this.targetZ;
    this.hasLast = true;
    this.lit = false;
    this.targetAge = 0;
    this.gapLeft = this.cfg.deker.gapTime;
  }
}
