import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { intervalAt, levelAt, speedAt } from '../src/core/difficulty';
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
  it('rastie s herným časom: rýchlosť 2 → 5 m/s, interval sa skracuje', () => {
    const d = CONFIG.difficulty;
    let prev = -1;
    for (let t = 0; t <= 300; t += 5) {
      const level = levelAt(t, 'medium', d);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
    expect(speedAt(levelAt(0, 'medium', d), d)).toBe(2);
    expect(speedAt(levelAt(1000, 'medium', d), d)).toBe(5);
    expect(intervalAt(levelAt(0, 'medium', d), d)).toBe(d.intervalMax);
    expect(intervalAt(levelAt(1000, 'medium', d), d)).toBe(d.intervalMin);
    expect(d.intervalMin).toBeLessThan(d.intervalMax);
  });

  it('predvoľby: ľahká má nižšie maximum, ťažká začína nad strednou hranicou', () => {
    const d = CONFIG.difficulty;
    expect(levelAt(1000, 'easy', d)).toBeLessThan(1);
    expect(levelAt(0, 'hard', d)).toBeGreaterThanOrEqual(d.unlock.doubleBlock);
    expect(levelAt(60, 'hard', d)).toBeGreaterThan(levelAt(60, 'medium', d));
  });

  it('prekážka je viditeľná dosť dlho na reakciu aj pri najvyššej rýchlosti', () => {
    const maxSpeed = Math.max(...(['easy', 'medium', 'hard'] as const).map((p) => speedAt(levelAt(1e6, p, CONFIG.difficulty), CONFIG.difficulty)));
    expect(CONFIG.obstacles.spawnDistance / maxSpeed).toBeGreaterThanOrEqual(CONFIG.fairness.minReactionTime);
  });

  it('úroveň v simulácii rastie len s herným časom', () => {
    const { sim } = makeSim();
    stepFor(sim, 20, DUCKED);
    expect(sim.level).toBeCloseTo(levelAt(sim.time, 'medium', CONFIG.difficulty), 12);
    expect(sim.speed).toBeCloseTo(speedAt(sim.level, CONFIG.difficulty), 12);
  });
});
