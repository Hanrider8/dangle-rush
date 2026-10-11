/**
 * Obtiažnosť rastie s čistým herným časom (pauzy sa nerátajú). Úroveň d ∈ ⟨0, maxLevel⟩
 * určuje rýchlosť prekážok, interval spawnu a odomknuté typy prekážok.
 */
import type { Config } from '../config';
import { clamp, lerp } from './math';
import type { Difficulty } from './settings';

type DifficultyConfig = Config['difficulty'];

export function levelAt(time: number, difficulty: Difficulty, cfg: DifficultyConfig): number {
  const p = cfg.presets[difficulty];
  return clamp(p.startLevel + time / p.rampSeconds, 0, p.maxLevel);
}

/** Rýchlosť prekážok v m/s (~2 → 5). */
export function speedAt(level: number, cfg: DifficultyConfig): number {
  return lerp(cfg.speedMin, cfg.speedMax, level);
}

/** Interval medzi vlnami v sekundách (~2,5 → 1,0). */
export function intervalAt(level: number, cfg: DifficultyConfig): number {
  return lerp(cfg.intervalMax, cfg.intervalMin, level);
}
