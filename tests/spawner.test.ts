import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { intervalAt, levelAt, speedAt } from '../src/core/difficulty';
import { EventQueue } from '../src/core/events';
import { headWindow } from '../src/core/obstacles';
import type { Difficulty } from '../src/core/settings';
import { GameplaySim } from '../src/core/sim';
import { Spawner, createWave, type WaveSpec } from '../src/core/spawner';

const F = CONFIG.fairness;
const W = CONFIG.playArea.width;

interface Recorded extends WaveSpec {
  time: number;
  level: number;
}

/** Postupnosť vĺn ako v simulácii (časovač spawnu podľa obtiažnosti), bez zásahov. */
function waves(seed: number, difficulty: Difficulty, seconds: number, floor = true): Recorded[] {
  const spawner = new Spawner(CONFIG, seed);
  const out: Recorded[] = [];
  const dt = 1 / 30;
  let next = CONFIG.rules.firstSpawnDelay;
  for (let t = 0; t < seconds; t += dt) {
    if (t < next) continue;
    const level = levelAt(t, difficulty, CONFIG.difficulty);
    const w = spawner.next(t, level, speedAt(level, CONFIG.difficulty), floor);
    if (!w) continue;
    out.push({ ...w, time: t, level });
    next = t + intervalAt(level, CONFIG.difficulty);
  }
  return out;
}

/** Nezávislá kontrola pravidiel spravodlivosti; vráti zoznam porušení. */
function check(list: Recorded[]): string[] {
  const errors: string[] = [];
  const arrival = (w: Recorded) => w.time + CONFIG.obstacles.spawnDistance / speedAt(w.level, CONFIG.difficulty);
  const win = { lo: 0, hi: 0 };
  const windowOf = (w: Recorded) => {
    headWindow(w.body!, w.bodySide, w.bodyGapX, CONFIG, win);
    return { lo: win.lo, hi: win.hi };
  };
  let lastFloor: Recorded | null = null;
  list.forEach((w, i) => {
    const at = arrival(w);
    if (CONFIG.obstacles.spawnDistance / speedAt(w.level, CONFIG.difficulty) < F.minReactionTime) {
      errors.push(`${i}: málo času na reakciu`);
    }
    if (i > 0 && at - arrival(list[i - 1]!) < F.minWaveGapTime - 1e-9) errors.push(`${i}: vlny príliš blízko`);
    if (w.body) {
      const a = windowOf(w);
      for (let j = i - 1; j >= 0; j--) {
        const p = list[j]!;
        if (at - arrival(p) >= F.minLateralSwitchTime) break;
        if (!p.body) continue;
        const b = windowOf(p);
        if (a.lo > b.hi || a.hi < b.lo) errors.push(`${i}: úhyb na opačnú stranu po ${(at - arrival(p)).toFixed(2)} s`);
      }
    }
    if (w.floor) {
      if (Math.abs(w.floorGapX) + w.floorGapW / 2 > W / 2 + 1e-9) errors.push(`${i}: medzera mimo plochy`);
      if (lastFloor) {
        const dt = at - arrival(lastFloor);
        if (Math.abs(w.floorGapX - lastFloor.floorGapX) > F.maxBallShiftSpeed * dt + 1e-9) {
          errors.push(`${i}: loptička by sa musela presunúť príliš rýchlo`);
        }
      }
      lastFloor = w;
    }
    if (w.body && w.floor) {
      if (w.body === 'sideBlock' && w.bodySide * w.floorGapX > F.comboSideTolerance) {
        errors.push(`${i}: kombinácia blok + medzera na strane bloku`);
      }
      if (w.body === 'doubleBlock' && Math.abs(w.floorGapX - w.bodyGapX) > F.comboDoubleGapTolerance) {
        errors.push(`${i}: kombinácia dvojitý blok + vzdialená medzera`);
      }
      if (w.body === 'highBar' && w.level >= F.highSpeedLevel && Math.abs(w.floorGapX) > F.highSpeedMaxFloorOffset) {
        errors.push(`${i}: krajná medzera pri vysokej rýchlosti`);
      }
    }
  });
  return errors;
}

describe('spawner', () => {
  it('rovnaký seed dá rovnaké vlny', () => {
    expect(waves(5, 'medium', 120)).toEqual(waves(5, 'medium', 120));
    expect(waves(5, 'medium', 120)).not.toEqual(waves(6, 'medium', 120));
  });

  it('typy pribúdajú postupne a kombinácie až od strednej obtiažnosti', () => {
    const u = CONFIG.difficulty.unlock;
    for (let seed = 1; seed <= 30; seed++) {
      for (const w of waves(seed, 'medium', 240)) {
        if (w.level < u.sideBlock) expect(w.body === null || w.body === 'highBar').toBe(true);
        if (w.level < u.coneGate) expect(w.floor === null || w.floor === 'lowBar').toBe(true);
        if (w.level < u.doubleBlock) expect(w.body).not.toBe('doubleBlock');
        if (w.level < u.combos) expect(w.body !== null && w.floor !== null).toBe(false);
      }
    }
  });

  it('za 4 minúty príde každý typ prekážky aj kombinácie', () => {
    const all = waves(9, 'medium', 240);
    for (const kind of ['highBar', 'sideBlock', 'doubleBlock'] as const) expect(all.some((w) => w.body === kind)).toBe(true);
    for (const kind of ['lowBar', 'coneGate'] as const) expect(all.some((w) => w.floor === kind)).toBe(true);
    expect(all.some((w) => w.body && w.floor)).toBe(true);
  });

  it('s vypnutými prekážkami na zemi nepríde žiadna', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(waves(seed, 'hard', 240, false).every((w) => w.floor === null)).toBe(true);
    }
  });

  it('odmietne protichodnú kombináciu (úkrok doprava a loptička úplne vľavo)', () => {
    const spawner = new Spawner(CONFIG, 1);
    const w = createWave();
    w.body = 'sideBlock';
    w.bodySide = -1; // blok vľavo → hráč ide doprava
    w.floor = 'coneGate';
    w.floorGapX = -0.45; // loptička úplne vľavo
    w.floorGapW = 0.4;
    w.arrival = 10;
    expect(spawner.violation(w, 0.9)).toBe('comboSide');
    w.floorGapX = 0.3;
    expect(spawner.violation(w, 0.9)).toBeNull();
  });

  it('kontrola pravidiel naozaj odhalí porušenie', () => {
    const wave = (time: number, over: Partial<Recorded>): Recorded => ({ ...createWave(), time, level: 0.5, ...over });
    const bad = [
      wave(10, { body: 'sideBlock', bodySide: -1 }),
      wave(10.95, { body: 'sideBlock', bodySide: 1 }), // úhyb na opačnú stranu po 0,95 s
      wave(13, { body: 'sideBlock', bodySide: 1, floor: 'coneGate', floorGapX: 0.45, floorGapW: 0.4 }),
    ];
    const errors = check(bad);
    expect(errors.some((e) => e.includes('opačnú stranu'))).toBe(true);
    expect(errors.some((e) => e.includes('na strane bloku'))).toBe(true);
  });

  it('property test: 500 seedov × 3 obtiažnosti × 5 minút bez porušenia pravidiel', () => {
    const problems: string[] = [];
    let total = 0;
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 1; seed <= 500; seed++) {
        const list = waves(seed * 7919 + 1, difficulty, 300);
        total += list.length;
        for (const e of check(list)) problems.push(`${difficulty}/${seed} ${e}`);
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(total).toBeGreaterThan(1500 * 100);
  });
});

describe('skutočný príchod prekážok v simulácii', () => {
  it('rozostup prekážok pre telo pri hráčovi zodpovedá pravidlám aj pri zrýchľovaní', () => {
    for (const difficulty of ['medium', 'hard'] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const events = new EventQueue(256);
        const sim = new GameplaySim(CONFIG, events);
        sim.reset(seed, 1.7, difficulty, true);
        // Hlava ďaleko od dráhy: nič ju nezasiahne, prekážky len prechádzajú.
        const head = { x: 50, y: 1.7, z: 0 };
        const crossed = new Map<number, number>();
        for (let i = 0; i < 300 * 120; i++) {
          sim.step(CONFIG.sim.fixedDt, head, head);
          for (const o of sim.obstacles) {
            if (o.active && o.body && !crossed.has(o.id) && o.z >= 0) {
              crossed.set(o.id, sim.time);
            }
          }
          events.clear();
        }
        const times = [...crossed.values()];
        for (let i = 1; i < times.length; i++) {
          expect(times[i]! - times[i - 1]!).toBeGreaterThan(F.minWaveGapTime - 0.05);
        }
        expect(times.length).toBeGreaterThan(50);
      }
    }
  });
});
