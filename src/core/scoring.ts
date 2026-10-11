import type { Config } from '../config';

/**
 * Násobiteľ skóre podľa počtu prekonaných prekážok pre telo za sebou bez zásahu
 * (pred aktuálnou): ×1, po comboStep prekážkach ×2, … najviac ×maxMultiplier.
 */
export function comboMultiplier(combo: number, rules: Config['rules']): number {
  return Math.min(1 + Math.floor(combo / rules.comboStep), rules.maxMultiplier);
}
