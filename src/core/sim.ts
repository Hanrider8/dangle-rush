/**
 * Herná simulácia počas PLAYING: pohyb a spawn prekážok, swept kolízie hlavy, životy, skóre, obtiažnosť.
 * Krokuje sa len v stave PLAYING, takže pauza zmrazí všetko vrátane času a spawnu.
 * Deterministická: rovnaký seed a rovnaké pózy hlavy dajú rovnaký priebeh.
 */
import type { Config } from '../config';
import { sweptHeadHit } from './collision';
import { intervalAt, levelAt, speedAt } from './difficulty';
import type { EventQueue } from './events';
import {
  ELEM_HIT,
  ELEM_MISS,
  ELEM_PENDING,
  ELEM_UNKNOWN,
  MAX_ELEMENTS,
  MAX_OBSTACLES,
  Obstacle,
  makeConeGate,
  makeDoubleBlock,
  makeHighBar,
  makeLowBar,
  makePokeCheck,
  makeSideBlock,
  makeSlalom,
  makeStars,
  makeWideDangle,
  puckPassesElement,
} from './obstacles';
import { comboMultiplier } from './scoring';
import type { Difficulty } from './settings';
import { Spawner, type WaveSpec } from './spawner';
import type { PuckSample, Vec3 } from './types';

/** Bez kamery: puk sa nepozná. */
const NO_PUCK: PuckSample = { valid: false, x: 0, z: 0, age: 0 };

/** Stav simulácie ako obyčajný objekt (testy pauzy a pokračovania). */
export interface SimSnapshot {
  time: number;
  level: number;
  speed: number;
  spawnTimer: number;
  spawnPause: number;
  lives: number;
  score: number;
  combo: number;
  maxCombo: number;
  bodyPassed: number;
  floorPassed: number;
  floorHits: number;
  floorMisses: number;
  hits: number;
  rngState: number;
  obstacles: { id: number; kind: string; z: number; prevZ: number; resolved: boolean; hit: boolean }[];
}

export class GameplaySim {
  readonly obstacles: Obstacle[] = [];
  readonly spawner: Spawner;

  /** Čistý herný čas v sekundách. */
  time = 0;
  level = 0;
  speed = 0;
  spawnTimer = 0;
  /** Prestávka v spawne po zásahu. */
  spawnPause = 0;
  lives = 0;
  /** Skóre vrátane zlomkov z bonusu za čas; zobrazuje sa zaokrúhlené nadol. */
  score = 0;
  combo = 0;
  maxCombo = 0;
  bodyPassed = 0;
  floorPassed = 0;
  /** Prvky na zemi, ktorými puk prešiel / ktoré minul (len keď puk vidí kamera). */
  floorHits = 0;
  floorMisses = 0;
  hits = 0;

  eyeHeight: number;
  difficulty: Difficulty = 'medium';
  floorEnabled = true;

  private nextId = 1;
  private waveCount = 0;

  constructor(
    private readonly cfg: Config,
    private readonly events: EventQueue,
  ) {
    for (let i = 0; i < MAX_OBSTACLES; i++) this.obstacles.push(new Obstacle());
    this.spawner = new Spawner(cfg, 1);
    this.eyeHeight = cfg.head.defaultEyeHeight;
  }

  reset(seed: number, eyeHeight: number, difficulty: Difficulty, floorEnabled: boolean): void {
    for (const o of this.obstacles) o.active = false;
    this.eyeHeight = eyeHeight;
    this.difficulty = difficulty;
    this.floorEnabled = floorEnabled;
    this.time = 0;
    this.level = levelAt(0, difficulty, this.cfg.difficulty);
    this.speed = speedAt(this.level, this.cfg.difficulty);
    this.spawnTimer = this.cfg.rules.firstSpawnDelay;
    this.spawnPause = 0;
    this.lives = this.cfg.rules.lives;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.bodyPassed = 0;
    this.floorPassed = 0;
    this.floorHits = 0;
    this.floorMisses = 0;
    this.hits = 0;
    this.waveCount = 0;
    this.spawner.reset(seed);
  }

  /**
   * Jeden fixný krok. h0 → h1 je pohyb stredu hlavy počas kroku (herný priestor), puck je odhad puku
   * z kamery (neplatný = prvky na zemi sa neposudzujú).
   */
  step(dt: number, h0: Vec3, h1: Vec3, puck: PuckSample = NO_PUCK): void {
    const cfg = this.cfg;
    this.time += dt;
    this.level = levelAt(this.time, this.difficulty, cfg.difficulty);
    this.speed = speedAt(this.level, cfg.difficulty);
    this.score += cfg.rules.timeBonusPerSecond * dt;

    const radius = cfg.head.radius;
    const ballZ = -cfg.playArea.centerDistance;
    const despawnZ = cfg.obstacles.despawnBehind;
    const move = this.speed * dt;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i]!;
      if (!o.active) continue;
      o.prevZ = o.z;
      o.z += move;
      if (!o.body && o.judged < o.elemCount) this.judgeFloor(o, ballZ, puck);
      if (!o.resolved) {
        if (o.body) {
          if (sweptHeadHit(o, h0, h1, radius)) {
            this.onHit(o);
            if (this.lives <= 0) return;
            continue;
          }
          if (o.z - o.halfDepth > h1.z + radius) this.onBodyPassed(o);
        } else if (o.z - o.length - o.halfDepth > ballZ) {
          // Vzor sa počíta raz, keď plochou prejde jeho posledný prvok (n = posúdené prvky).
          o.resolved = true;
          this.floorPassed++;
          let judged = 0;
          for (let k = 0; k < o.elemCount; k++) {
            if (o.elemResult[k] === ELEM_HIT || o.elemResult[k] === ELEM_MISS) judged++;
          }
          this.events.push('passFloor', o.kind, judged);
        }
      }
      if (o.z - o.length - o.halfDepth > despawnZ) o.active = false;
    }

    if (this.spawnPause > 0) {
      this.spawnPause = Math.max(0, this.spawnPause - dt);
      return;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const w = this.spawner.next(this.time, this.level, this.speed, this.floorEnabled);
      if (w) {
        this.spawnWave(w);
        // Ďalšia vlna počká aj na koniec vzoru (slalom, hviezdy, široké miesanie).
        this.spawnTimer += intervalAt(this.level, cfg.difficulty) + (w.arrivalEnd - w.arrival);
      }
    }
  }

  snapshot(): SimSnapshot {
    return {
      time: this.time,
      level: this.level,
      speed: this.speed,
      spawnTimer: this.spawnTimer,
      spawnPause: this.spawnPause,
      lives: this.lives,
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      bodyPassed: this.bodyPassed,
      floorPassed: this.floorPassed,
      floorHits: this.floorHits,
      floorMisses: this.floorMisses,
      hits: this.hits,
      rngState: this.spawner.rngState,
      obstacles: this.obstacles
        .filter((o) => o.active)
        .map((o) => ({ id: o.id, kind: o.kind, z: o.z, prevZ: o.prevZ, resolved: o.resolved, hit: o.hit })),
    };
  }

  private spawnWave(w: WaveSpec): void {
    this.waveCount++;
    const cfg = this.cfg;
    const z = -cfg.obstacles.spawnDistance;
    if (w.body) {
      const o = this.allocate(z);
      if (o) {
        if (w.body === 'highBar') makeHighBar(o, this.eyeHeight, this.cfg);
        else if (w.body === 'sideBlock') makeSideBlock(o, w.bodySide, this.eyeHeight, this.cfg);
        else makeDoubleBlock(o, w.bodyGapX, this.eyeHeight, this.cfg);
        this.events.push('spawn', o.kind, o.id);
      }
    }
    if (w.floor) {
      const o = this.allocate(z);
      if (o) {
        // Rozostup prvkov vzoru podľa aktuálnej rýchlosti, aby čas medzi nimi sedel s floorElementTime.
        const spacing = this.speed * w.floorElementTime;
        switch (w.floor) {
          case 'lowBar':
            makeLowBar(o, w.floorSide, w.floorCoverage, cfg);
            break;
          case 'coneGate':
            makeConeGate(o, w.floorCenterX, cfg);
            break;
          case 'slalom':
            makeSlalom(o, w.floorCount, w.floorCenterX, w.floorSide, spacing, cfg);
            break;
          case 'stars':
            makeStars(o, w.floorXs, w.floorCount, spacing, cfg);
            break;
          case 'wideDangle':
            makeWideDangle(o, w.floorSide, spacing, cfg);
            break;
          case 'pokeCheck': {
            // Presun hokejky skončí settleTime pred príchodom k puku a trvá sweepTime.
            const c = cfg.obstacles.pokeCheck;
            const z1 = -cfg.playArea.centerDistance - this.speed * c.settleTime;
            const z0 = Math.max(z, z1 - this.speed * c.sweepTime);
            makePokeCheck(o, w.floorSide, w.floorCoverage, z0, z1, cfg);
            break;
          }
        }
        this.events.push('spawn', o.kind, o.id);
      }
    }
  }

  private allocate(z: number): Obstacle | null {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i]!;
      if (o.active) continue;
      o.active = true;
      o.id = this.nextId++;
      o.z = z;
      o.prevZ = z;
      o.resolved = false;
      o.hit = false;
      o.wave = this.waveCount;
      return o;
    }
    return null;
  }

  /**
   * Posúdenie prvkov vzoru pukom. Kamera vidí puk s oneskorením (puck.age): prvok sa posúdi, keď
   * v čase zachytenia puku už prešiel jeho čiarou, a podľa polohy puku v tom čase. Bez puku (alebo
   * keď ho kamera uvidela až neskoro) prvok len prejde stredom plochy ako neposúdený.
   */
  private judgeFloor(o: Obstacle, ballZ: number, puck: PuckSample): void {
    const p = this.cfg.puck;
    const usable = puck.valid && puck.age <= p.maxAge;
    for (let i = 0; i < o.elemCount; i++) {
      if (o.elemResult[i] !== ELEM_PENDING) continue;
      const z = o.z + o.elemDz[i]!;
      const code = o.id * MAX_ELEMENTS + i;
      if (usable) {
        const past = z - this.speed * puck.age - puck.z;
        if (past < 0) continue;
        if (past <= p.maxLateJudge) {
          o.judged++;
          if (puckPassesElement(o, i, puck.x, this.cfg)) {
            o.elemResult[i] = ELEM_HIT;
            this.onFloorHit(o, code);
          } else {
            o.elemResult[i] = ELEM_MISS;
            this.floorMisses++;
            this.combo = 0;
            this.events.push('floorMiss', o.kind, code);
          }
          continue;
        }
      }
      if (z > ballZ) {
        o.elemResult[i] = ELEM_UNKNOWN;
        o.judged++;
        this.events.push('floorPass', o.kind, code);
      }
    }
  }

  private onFloorHit(o: Obstacle, code: number): void {
    const multiplier = comboMultiplier(this.combo, this.cfg.rules);
    this.score += this.cfg.puck.scorePerHit * multiplier;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.floorHits++;
    this.events.push('floorHit', o.kind, code);
  }

  private onBodyPassed(o: Obstacle): void {
    o.resolved = true;
    const multiplier = comboMultiplier(this.combo, this.cfg.rules);
    this.score += this.cfg.rules.scorePerBody * multiplier;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.bodyPassed++;
    this.events.push('passBody', o.kind, o.id);
  }

  private onHit(o: Obstacle): void {
    o.resolved = true;
    o.hit = true;
    this.lives--;
    this.hits++;
    this.combo = 0;
    this.events.push('hit', o.kind, this.lives);
    // Najbližšie prekážky zmiznú a spawn sa na chvíľu pozastaví.
    const clearZ = -this.cfg.rules.hitClearDistance;
    for (let i = 0; i < this.obstacles.length; i++) {
      const other = this.obstacles[i]!;
      if (other.active && other.z + other.halfDepth > clearZ) {
        other.active = false;
        this.events.push('cleared', other.kind, other.id);
      }
    }
    this.spawnPause = this.cfg.rules.hitSpawnPause;
    this.spawner.clearHistory();
  }
}
