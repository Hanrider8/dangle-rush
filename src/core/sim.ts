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
  MAX_OBSTACLES,
  Obstacle,
  makeConeGate,
  makeDoubleBlock,
  makeHighBar,
  makeLowBar,
  makeSideBlock,
} from './obstacles';
import { comboMultiplier } from './scoring';
import type { Difficulty } from './settings';
import { Spawner } from './spawner';
import type { Vec3 } from './types';

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
    this.hits = 0;
    this.waveCount = 0;
    this.spawner.reset(seed);
  }

  /** Jeden fixný krok. h0 → h1 je pohyb stredu hlavy počas kroku (herný priestor). */
  step(dt: number, h0: Vec3, h1: Vec3): void {
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
      if (!o.resolved) {
        if (o.body) {
          if (sweptHeadHit(o, h0, h1, radius)) {
            this.onHit(o);
            if (this.lives <= 0) return;
            continue;
          }
          if (o.z - o.halfDepth > h1.z + radius) this.onBodyPassed(o);
        } else if (o.z - o.halfDepth > ballZ) {
          // Prekážky na zemi sa nevyhodnocujú, len sa počíta, koľko ich prešlo plochou.
          o.resolved = true;
          this.floorPassed++;
          this.events.push('passFloor', o.kind, o.id);
        }
      }
      if (o.z - o.halfDepth > despawnZ) o.active = false;
    }

    if (this.spawnPause > 0) {
      this.spawnPause = Math.max(0, this.spawnPause - dt);
      return;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.spawnWave()) {
      this.spawnTimer += intervalAt(this.level, cfg.difficulty);
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
      hits: this.hits,
      rngState: this.spawner.rngState,
      obstacles: this.obstacles
        .filter((o) => o.active)
        .map((o) => ({ id: o.id, kind: o.kind, z: o.z, prevZ: o.prevZ, resolved: o.resolved, hit: o.hit })),
    };
  }

  private spawnWave(): boolean {
    const w = this.spawner.next(this.time, this.level, this.speed, this.floorEnabled);
    if (!w) return false;
    this.waveCount++;
    const z = -this.cfg.obstacles.spawnDistance;
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
        if (w.floor === 'lowBar') makeLowBar(o, w.floorSide, w.floorCoverage, this.cfg);
        else makeConeGate(o, w.floorGapX, this.cfg);
        this.events.push('spawn', o.kind, o.id);
      }
    }
    return true;
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

  private onBodyPassed(o: Obstacle): void {
    o.resolved = true;
    const multiplier = comboMultiplier(this.combo, this.cfg.rules);
    this.score += this.cfg.rules.scorePerBody * multiplier;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.bodyPassed++;
    this.events.push('passBody', o.kind, multiplier);
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
