import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { levelParams } from '../src/core/difficulty';
import { DIFFICULTIES } from '../src/core/settings';
import { EventQueue } from '../src/core/events';
import { makeHighBar, makeLowBar, type Obstacle } from '../src/core/obstacles';
import { comboMultiplier } from '../src/core/scoring';
import { GameplaySim } from '../src/core/sim';
import type { Vec3 } from '../src/core/types';

const DT = CONFIG.sim.fixedDt;
const H = 1.7;
const DUCKED: Vec3 = { x: 0, y: 1.2, z: 0 };
const STANDING: Vec3 = { x: 0, y: H, z: 0 };

function makeSim(seed = 3) {
  const events = new EventQueue(1024);
  const sim = new GameplaySim(CONFIG, events);
  sim.reset(seed, H, 'medium', true);
  return { sim, events };
}

/** Vypne automatický spawn a vloží prekážku na pozíciu z. */
function place(sim: GameplaySim, z: number, make: (o: Obstacle) => void): Obstacle {
  sim.spawnPause = 1e9;
  const o = sim.obstacles.find((x) => !x.active)!;
  make(o);
  o.active = true;
  o.resolved = false;
  o.hit = false;
  o.id = 1000 + sim.obstacles.indexOf(o);
  o.z = o.prevZ = z;
  return o;
}

function stepFor(sim: GameplaySim, seconds: number, head: Vec3) {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.step(DT, head, head);
}

describe('skóre a combo', () => {
  it('násobiteľ rastie po každých 5 prekážkach bez chyby, najviac ×5', () => {
    expect([0, 4, 5, 9, 10, 15, 20, 99].map((c) => comboMultiplier(c, CONFIG.rules))).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
  });

  it('+100 × násobiteľ za prekážku pre telo a bonus za čas', () => {
    const { sim } = makeSim();
    for (let i = 0; i < 12; i++) place(sim, -1 - i * 0.6, (o) => makeHighBar(o, H, CONFIG));
    stepFor(sim, 6, DUCKED);
    expect(sim.bodyPassed).toBe(12);
    expect(sim.combo).toBe(12);
    expect(sim.maxCombo).toBe(12);
    const bodyScore = 100 * (5 * 1 + 5 * 2 + 2 * 3);
    expect(sim.score).toBeCloseTo(bodyScore + CONFIG.rules.timeBonusPerSecond * sim.time, 6);
  });

  it('prekážky na zemi sa počítajú zvlášť a skóre neovplyvnia', () => {
    const { sim, events } = makeSim();
    place(sim, -2, (o) => makeLowBar(o, -1, 0.6, CONFIG));
    place(sim, -3, (o) => makeLowBar(o, 1, 0.6, CONFIG));
    stepFor(sim, 3, STANDING);
    expect(sim.floorPassed).toBe(2);
    expect(sim.bodyPassed).toBe(0);
    expect(sim.lives).toBe(CONFIG.rules.lives);
    expect(sim.score).toBeCloseTo(CONFIG.rules.timeBonusPerSecond * sim.time, 6);
    const types: string[] = [];
    events.drain((e) => types.push(e.type));
    expect(types.filter((t) => t === 'passFloor').length).toBe(2);
  });
});

describe('zásah', () => {
  it('−1 život, combo 0, najbližšie prekážky zmiznú a spawn sa na 1,5 s pozastaví', () => {
    const { sim } = makeSim();
    place(sim, -3, (o) => makeHighBar(o, H, CONFIG));
    stepFor(sim, 2, DUCKED);
    expect(sim.combo).toBe(1);

    const hitting = place(sim, -0.5, (o) => makeHighBar(o, H, CONFIG));
    const near = place(sim, -2.5, (o) => makeHighBar(o, H, CONFIG));
    const far = place(sim, -5.5, (o) => makeHighBar(o, H, CONFIG));
    const floorNear = place(sim, -1.5, (o) => makeLowBar(o, -1, 0.6, CONFIG));
    sim.spawnPause = 0;
    sim.spawnTimer = 0.01;
    stepFor(sim, 0.3, STANDING);
    expect(sim.lives).toBe(CONFIG.rules.lives - 1);
    expect(sim.hits).toBe(1);
    expect(sim.combo).toBe(0);
    expect(hitting.active).toBe(false);
    expect(near.active).toBe(false);
    expect(floorNear.active).toBe(false);
    expect(far.active).toBe(true);
    expect(sim.spawnPause).toBeGreaterThan(1.1);
    const ids = sim.obstacles.filter((o) => o.active).map((o) => o.id);
    stepFor(sim, 1.1, DUCKED);
    expect(sim.obstacles.filter((o) => o.active).map((o) => o.id)).toEqual(ids); // počas pauzy nič nové
    // Po pauze sa spawn obnoví (hodiny spawnu počas pauzy stáli; po vzore čaká aj na jeho koniec).
    stepFor(sim, 8, DUCKED);
    expect(sim.obstacles.some((o) => o.active && !ids.includes(o.id))).toBe(true);
  });

  it('po strate posledného života má simulácia 0 životov', () => {
    const { sim } = makeSim();
    for (let i = 0; i < CONFIG.rules.lives; i++) {
      place(sim, -0.4, (o) => makeHighBar(o, H, CONFIG));
      stepFor(sim, 0.3, STANDING);
    }
    expect(sim.lives).toBe(0);
  });
});

describe('prekážky', () => {
  it('zmiznú 1 m za hráčom', () => {
    const { sim } = makeSim();
    const o = place(sim, -1, (x) => makeHighBar(x, H, CONFIG));
    while (o.active) sim.step(DT, DUCKED, DUCKED);
    expect(o.z - o.halfDepth).toBeGreaterThan(CONFIG.obstacles.despawnBehind);
    expect(o.z - o.halfDepth).toBeLessThan(CONFIG.obstacles.despawnBehind + 0.1);
  });

  it('objavia sa 7 m pred hráčom a idú k nemu aktuálnou rýchlosťou', () => {
    const { sim } = makeSim();
    let first: Obstacle | undefined;
    for (let i = 0; i < 200 && !first; i++) {
      sim.step(DT, DUCKED, DUCKED);
      first = sim.obstacles.find((o) => o.active);
    }
    expect(first).toBeDefined();
    expect(first!.z).toBeCloseTo(-CONFIG.obstacles.spawnDistance, 1);
    const z = first!.z;
    sim.step(DT, DUCKED, DUCKED);
    expect(first!.z - z).toBeCloseTo(sim.speed * DT, 9);
  });

  it('rovnaký seed dá rovnaký priebeh, iný seed iný', () => {
    const run = (seed: number) => {
      const { sim } = makeSim(seed);
      stepFor(sim, 30, DUCKED);
      return sim.snapshot();
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
  });
});

describe('obtiažnosť', () => {
  it('päť pevných úrovní: rýchlosť rastie, interval sa skracuje, odomykanie podľa level', () => {
    const d = CONFIG.difficulty;
    const params = DIFFICULTIES.map((x) => levelParams(x, d));
    expect(DIFFICULTIES).toEqual(['warmup', 'easy', 'medium', 'hard', 'pro']);
    for (let i = 1; i < params.length; i++) {
      expect(params[i]!.level).toBeGreaterThan(params[i - 1]!.level);
      expect(params[i]!.speed).toBeGreaterThan(params[i - 1]!.speed);
      expect(params[i]!.interval).toBeLessThan(params[i - 1]!.interval);
    }
    expect(levelParams('warmup', d).level).toBeLessThan(d.unlock.slalom);
    expect(levelParams('easy', d).level).toBeGreaterThanOrEqual(d.unlock.sideBlock);
    expect(levelParams('easy', d).level).toBeLessThan(d.unlock.pokeCheck);
    expect(levelParams('medium', d).level).toBeGreaterThanOrEqual(d.unlock.doubleBlock);
    expect(levelParams('medium', d).level).toBeGreaterThanOrEqual(d.unlock.combos);
  });

  it('prekážka je viditeľná dosť dlho na reakciu aj na najvyššej úrovni', () => {
    const maxSpeed = Math.max(...DIFFICULTIES.map((x) => levelParams(x, CONFIG.difficulty).speed));
    expect(CONFIG.obstacles.spawnDistance / maxSpeed).toBeGreaterThanOrEqual(CONFIG.fairness.minReactionTime);
  });

  it('hra sa nezrýchľuje: úroveň, rýchlosť aj interval sú po 5 minútach rovnaké ako na začiatku', () => {
    for (const difficulty of DIFFICULTIES) {
      const events = new EventQueue(1024);
      const sim = new GameplaySim(CONFIG, events);
      sim.reset(3, H, difficulty, true);
      const p = levelParams(difficulty, CONFIG.difficulty);
      expect(sim.speed).toBe(p.speed);
      for (let i = 0; i < 300 * 120; i++) {
        sim.step(CONFIG.sim.fixedDt, DUCKED, DUCKED);
        events.clear();
        if (sim.lives <= 0) break;
      }
      expect(sim.level).toBe(p.level);
      expect(sim.speed).toBe(p.speed);
      expect(sim.interval).toBe(p.interval);
    }
  });
});
