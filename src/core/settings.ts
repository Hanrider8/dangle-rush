/**
 * Nastavenia a osobné rekordy. Ukladajú sa do localStorage cez rozhranie KeyValueStorage,
 * takže logika sa dá testovať bez prehliadača. Načítané hodnoty sa vždy validujú.
 */
import type { Config } from '../config';
import { clamp } from './math';

export type PauseSide = 'left' | 'right';
export type PausePosition = 'side' | 'top';
export type Difficulty = 'warmup' | 'easy' | 'medium' | 'hard' | 'pro';

export const DIFFICULTIES: readonly Difficulty[] = ['warmup', 'easy', 'medium', 'hard', 'pro'];

export interface Settings {
  dwellTime: number;
  pauseSide: PauseSide;
  pausePosition: PausePosition;
  difficulty: Difficulty;
  floorObstacles: boolean;
  /** Hlava hore: spoluhráč nad horizontom a zatmavenie podlahy. */
  headUp: boolean;
  countdown: number;
  /** Obnovovacia frekvencia XR (Hz). */
  frameRate: number;
  /** Kalibrovaná výška očí v stoji; null = ešte nekalibrované (spustí sa SETUP). */
  eyeHeight: number | null;
  debug: boolean;
}

export type BestScores = Record<Difficulty, number>;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'dangleRush.settings.v1';
/** v2: pevné úrovne obtiažnosti (rekordy z hry so zrýchľovaním sa nedajú porovnať). */
export const BEST_KEY = 'dangleRush.best.v2';
/** Rekordy režimu Deker (pre každú obtiažnosť zvlášť). */
export const BEST_DEKER_KEY = 'dangleRush.bestDeker.v1';

/** Úložisko v pamäti: pre testy a ako náhrada, keď localStorage nie je dostupný. */
export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

export function defaultSettings(cfg: Config): Settings {
  return {
    dwellTime: cfg.gaze.dwellTime,
    pauseSide: 'right',
    pausePosition: 'side',
    difficulty: 'easy',
    floorObstacles: true,
    headUp: true,
    countdown: cfg.countdown.default,
    frameRate: cfg.render.targetFrameRate,
    eyeHeight: null,
    debug: false,
  };
}

/** Zaokrúhli na mriežku min + k·step (na tisíciny, aby 0,8 + 2·0,2 bolo presne 1,2). */
function snapToStep(value: number, min: number, step: number): number {
  const k = Math.round((value - min) / step);
  return Math.round((min + k * step) * 1000) / 1000;
}

/** Z ľubovoľného vstupu (napr. poškodený JSON) vyrobí platné nastavenia. */
export function sanitizeSettings(raw: unknown, cfg: Config): Settings {
  const s = defaultSettings(cfg);
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  const g = cfg.gaze;

  if (typeof r.dwellTime === 'number' && Number.isFinite(r.dwellTime)) {
    s.dwellTime = snapToStep(clamp(r.dwellTime, g.dwellMin, g.dwellMax), g.dwellMin, g.dwellStep);
  }
  if (r.pauseSide === 'left' || r.pauseSide === 'right') s.pauseSide = r.pauseSide;
  if (r.pausePosition === 'side' || r.pausePosition === 'top') s.pausePosition = r.pausePosition;
  if (typeof r.difficulty === 'string' && (DIFFICULTIES as readonly string[]).includes(r.difficulty)) {
    s.difficulty = r.difficulty as Difficulty;
  }
  if (typeof r.floorObstacles === 'boolean') s.floorObstacles = r.floorObstacles;
  if (typeof r.headUp === 'boolean') s.headUp = r.headUp;
  if (typeof r.countdown === 'number' && Number.isFinite(r.countdown)) {
    s.countdown = Math.round(clamp(r.countdown, cfg.countdown.min, cfg.countdown.max));
  }
  if (typeof r.frameRate === 'number' && cfg.render.frameRates.includes(r.frameRate)) s.frameRate = r.frameRate;
  if (
    typeof r.eyeHeight === 'number' &&
    r.eyeHeight >= cfg.head.minEyeHeight &&
    r.eyeHeight <= cfg.head.maxEyeHeight
  ) {
    s.eyeHeight = r.eyeHeight;
  }
  if (typeof r.debug === 'boolean') s.debug = r.debug;
  return s;
}

function readJson(storage: KeyValueStorage, key: string): unknown {
  try {
    const text = storage.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function writeJson(storage: KeyValueStorage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Plné alebo zablokované úložisko: hra pokračuje bez uloženia.
  }
}

export function loadSettings(storage: KeyValueStorage, cfg: Config): Settings {
  return sanitizeSettings(readJson(storage, SETTINGS_KEY), cfg);
}

export function saveSettings(storage: KeyValueStorage, settings: Settings): void {
  writeJson(storage, SETTINGS_KEY, settings);
}

export function loadBest(storage: KeyValueStorage, key = BEST_KEY): BestScores {
  const best: BestScores = { warmup: 0, easy: 0, medium: 0, hard: 0, pro: 0 };
  const raw = readJson(storage, key);
  if (typeof raw === 'object' && raw !== null) {
    for (const d of DIFFICULTIES) {
      const v = (raw as Record<string, unknown>)[d];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) best[d] = Math.floor(v);
    }
  }
  return best;
}

export function saveBest(storage: KeyValueStorage, best: BestScores, key = BEST_KEY): void {
  writeJson(storage, key, best);
}

/** Ďalšia hodnota dwell v cykle 0,8 → 1,0 → … → 2,0 → 0,8. */
export function cycleDwell(current: number, cfg: Config): number {
  const g = cfg.gaze;
  const next = snapToStep(current + g.dwellStep, g.dwellMin, g.dwellStep);
  return next > g.dwellMax + 1e-9 ? g.dwellMin : next;
}

export function cycleCountdown(current: number, cfg: Config): number {
  const next = Math.round(current) + 1;
  return next > cfg.countdown.max ? cfg.countdown.min : next;
}

/** Ďalšia obnovovacia frekvencia v cykle 72 → 90 → 120 → 72. */
export function cycleFrameRate(current: number, cfg: Config): number {
  const rates = cfg.render.frameRates;
  const i = rates.indexOf(current);
  return rates[(i + 1) % rates.length]!;
}

export function nextDifficulty(current: Difficulty): Difficulty {
  return DIFFICULTIES[(DIFFICULTIES.indexOf(current) + 1) % DIFFICULTIES.length]!;
}
