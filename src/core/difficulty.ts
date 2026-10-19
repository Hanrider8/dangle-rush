/**
 * Pevné úrovne obtiažnosti (config.difficulty.levels): počas hry sa rýchlosť ani tempo nemenia.
 * Úroveň level ∈ ⟨0, 1⟩ určuje odomknuté typy prekážok, podiel obrancov a pravidlá spravodlivosti.
 */
import type { Config } from '../config';
import type { Difficulty } from './settings';

export interface LevelParams {
  /** 0–1: odomknuté typy prekážok, podiel obrancov, kombinácie. */
  level: number;
  /** Rýchlosť prekážok (m/s). */
  speed: number;
  /** Čas medzi vlnami (s); po vzore sa predĺži o jeho dĺžku. */
  interval: number;
}

export function levelParams(difficulty: Difficulty, cfg: Config['difficulty']): LevelParams {
  return cfg.levels[difficulty];
}
