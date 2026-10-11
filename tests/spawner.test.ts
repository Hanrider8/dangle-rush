import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { intervalAt, levelAt, speedAt } from '../src/core/difficulty';
import { EventQueue } from '../src/core/events';
import { headWindow, lowBarGap } from '../src/core/obstacles';
import type { Difficulty } from '../src/core/settings';
import { GameplaySim } from '../src/core/sim';
import { Spawner, createWave, type WaveSpec } from '../src/core/spawner';
import type { FloorKind } from '../src/core/types';

const F = CONFIG.fairness;
const O = CONFIG.obstacles;
const W = CONFIG.playArea.width;
const FLOOR_KINDS: FloorKind[] = ['lowBar', 'coneGate', 'slalom', 'stars', 'wideDangle', 'pokeCheck'];

interface Recorded extends WaveSpec {
  time: number;
  level: number;
  speed: number;
}

/** Postupnosť vĺn ako v simulácii (časovač spawnu podľa obtiažnosti a dĺžky vzorov), bez zásahov. */
function waves(seed: number, difficulty: Difficulty, seconds: number, floor = true): Recorded[] {
  const spawner = new Spawner(CONFIG, seed);
  const out: Recorded[] = [];
  const dt = 1 / 30;
  let next = CONFIG.rules.firstSpawnDelay;
  for (let t = 0; t < seconds; t += dt) {
    if (t < next) continue;
    const level = levelAt(t, difficulty, CONFIG.difficulty);
    const speed = speedAt(level, CONFIG.difficulty);
    const w = spawner.next(t, level, speed, floor);
    if (!w) continue;
    out.push({ ...w, floorXs: w.floorXs.slice(), time: t, level, speed });
    next = t + intervalAt(level, CONFIG.difficulty) + (w.arrivalEnd - w.arrival);
  }
  return out;
}

/** Kadiaľ ide puk pri každom prvku vzoru (nezávislý výpočet zo zadania vlny). */
function puckPath(w: Recorded): number[] {
  switch (w.floor) {
    case 'lowBar':
      return [lowBarGap(w.floorSide, w.floorCoverage, CONFIG).gapX];
    case 'coneGate':
      return [w.floorCenterX];
    case 'slalom':
      return Array.from({ length: w.floorCount }, (_, i) => w.floorCenterX + (i % 2 === 0 ? 1 : -1) * w.floorSide * O.slalom.passOffset);
    case 'stars':
      return Array.from(w.floorXs.slice(0, w.floorCount));
    case 'wideDangle':
      return [w.floorSide * O.wideDangle.offset, -w.floorSide * O.wideDangle.offset];
    case 'pokeCheck':
      return [(w.floorSide * w.floorCoverage * W) / 2];
    default:
      return [];
  }
}

/** Nezávislá kontrola pravidiel spravodlivosti; vráti zoznam porušení. */
function check(list: Recorded[]): string[] {
  const errors: string[] = [];
  const arrival = (w: Recorded) => w.time + O.spawnDistance / w.speed;
  const arrivalEnd = (w: Recorded) => arrival(w) + Math.max(0, puckPath(w).length - 1) * w.floorElementTime;
  const win = { lo: 0, hi: 0 };
  const windowOf = (w: Recorded) => {
    headWindow(w.body!, w.bodySide, w.bodyGapX, CONFIG, win);
    return { lo: win.lo, hi: win.hi };
  };
  let lastFloor: Recorded | null = null;
  list.forEach((w, i) => {
    const at = arrival(w);
    if (O.spawnDistance / w.speed < F.minReactionTime) errors.push(`${i}: málo času na reakciu`);
    if (i > 0 && at - arrivalEnd(list[i - 1]!) < F.minWaveGapTime - 1e-9) errors.push(`${i}: vlny príliš blízko`);
    if (w.body) {
      const a = windowOf(w);
      for (let j = i - 1; j >= 0; j--) {
        const p = list[j]!;
        if (at - arrivalEnd(p) >= F.minLateralSwitchTime) break;
        if (!p.body) continue;
        const b = windowOf(p);
        if (a.lo > b.hi || a.hi < b.lo) errors.push(`${i}: úhyb na opačnú stranu po ${(at - arrival(p)).toFixed(2)} s`);
      }
    }
    if (w.floor) {
      const path = puckPath(w);
      if (path.some((x) => Math.abs(x) > W / 2)) errors.push(`${i}: puk mimo plochy (${w.floor})`);
      for (let k = 1; k < path.length; k++) {
        if (Math.abs(path[k]! - path[k - 1]!) > F.maxPuckShiftSpeed * w.floorElementTime + 1e-9) {
          errors.push(`${i}: vnútri vzoru ${w.floor} príliš rýchly presun puku`);
        }
      }
      if (lastFloor) {
        const prev = puckPath(lastFloor);
        const dt = at - arrivalEnd(lastFloor);
        if (Math.abs(path[0]! - prev[prev.length - 1]!) > F.maxPuckShiftSpeed * dt + 1e-9) {
          errors.push(`${i}: puk by sa musel presunúť príliš rýchlo`);
        }
      }
      lastFloor = w;
    }
    if (w.body && w.floor) {
      if (w.floor !== 'lowBar' && w.floor !== 'coneGate') errors.push(`${i}: obranca so zložitým vzorom ${w.floor}`);
      const x = puckPath(w)[0]!;
      if (w.body === 'sideBlock' && w.bodySide * x > F.comboSideTolerance) errors.push(`${i}: blok + medzera na strane bloku`);
      if (w.body === 'doubleBlock' && Math.abs(x - w.bodyGapX) > F.comboDoubleGapTolerance) {
        errors.push(`${i}: dvojitý blok + vzdialená medzera`);
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

  it('väčšina vĺn sú prekážky na zemi, obranca príde len občas a vysoká tyč nikdy', () => {
    let total = 0;
    let bodies = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const w of waves(seed, 'medium', 300)) {
        total++;
        if (w.body) bodies++;
        expect(w.body).not.toBe('highBar');
      }
    }
    expect(bodies / total).toBeGreaterThan(0.05);
    expect(bodies / total).toBeLessThan(CONFIG.spawn.bodyShareMax + 0.02);
  });

  it('typy pribúdajú postupne a kombinácie až od strednej obtiažnosti', () => {
    const u = CONFIG.difficulty.unlock;
    for (let seed = 1; seed <= 30; seed++) {
      for (const w of waves(seed, 'medium', 240)) {
        if (w.level < u.sideBlock) expect(w.body).toBeNull();
        if (w.level < u.doubleBlock) expect(w.body).not.toBe('doubleBlock');
        if (w.level < u.slalom) expect(w.floor).not.toBe('slalom');
        if (w.level < u.wideDangle) expect(w.floor).not.toBe('wideDangle');
        if (w.level < u.pokeCheck) expect(w.floor).not.toBe('pokeCheck');
        if (w.level < u.combos) expect(w.body !== null && w.floor !== null).toBe(false);
      }
    }
  });

  it('za 5 minút príde každý typ prekážky aj kombinácia s obrancom', () => {
    const all = [9, 10, 11].flatMap((seed) => waves(seed, 'medium', 300));
    for (const kind of ['sideBlock', 'doubleBlock'] as const) expect(all.some((w) => w.body === kind)).toBe(true);
    for (const kind of FLOOR_KINDS) expect(all.some((w) => w.floor === kind)).toBe(true);
    expect(all.some((w) => w.body && w.floor)).toBe(true);
  });

  it('s vypnutými prekážkami na zemi prídu len obrancovia (aj na začiatku)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const list = waves(seed, 'medium', 120, false);
      expect(list.length).toBeGreaterThan(20);
      expect(list.every((w) => w.floor === null && (w.body === 'sideBlock' || w.body === 'doubleBlock'))).toBe(true);
    }
  });

  it('odmietne protichodnú kombináciu (úkrok doprava a puk úplne vľavo)', () => {
    const spawner = new Spawner(CONFIG, 1);
    const w = createWave();
    w.body = 'sideBlock';
    w.bodySide = -1; // blok vľavo → hráč ide doprava
    w.floor = 'coneGate';
    w.floorCenterX = -0.7; // puk úplne vľavo
    w.firstPuckX = w.lastPuckX = -0.7;
    w.arrival = w.arrivalEnd = 10;
    expect(spawner.violation(w, 0.9)).toBe('comboSide');
    w.firstPuckX = w.lastPuckX = 0.3;
    expect(spawner.violation(w, 0.9)).toBeNull();
  });

  it('kontrola pravidiel naozaj odhalí porušenie', () => {
    const wave = (time: number, over: Partial<Recorded>): Recorded => ({
      ...createWave(),
      time,
      level: 0.5,
      speed: 3.5,
      ...over,
    });
    const bad = [
      wave(10, { body: 'sideBlock', bodySide: -1 }),
      wave(10.95, { body: 'sideBlock', bodySide: 1 }), // úhyb na opačnú stranu po 0,95 s
      wave(13, { body: 'sideBlock', bodySide: 1, floor: 'coneGate', floorCenterX: 0.7, floorCount: 1 }),
      wave(13.92, { floor: 'coneGate', floorCenterX: -0.7, floorCount: 1 }), // puk 1,4 m za 0,92 s
    ];
    const errors = check(bad);
    expect(errors.some((e) => e.includes('opačnú stranu'))).toBe(true);
    expect(errors.some((e) => e.includes('na strane bloku'))).toBe(true);
    expect(errors.some((e) => e.includes('príliš rýchlo'))).toBe(true);
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
    expect(total).toBeGreaterThan(1500 * 70);
  });
});

describe('skutočný príchod prekážok v simulácii', () => {
  it('obrancovia pri hráčovi dodržia rozostup aj pri zrýchľovaní', () => {
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
            if (o.active && o.body && !crossed.has(o.id) && o.z >= 0) crossed.set(o.id, sim.time);
          }
          events.clear();
        }
        const times = [...crossed.values()];
        for (let i = 1; i < times.length; i++) {
          expect(times[i]! - times[i - 1]!).toBeGreaterThan(F.minWaveGapTime - 0.05);
        }
        expect(times.length).toBeGreaterThan(5);
      }
    }
  });
});
