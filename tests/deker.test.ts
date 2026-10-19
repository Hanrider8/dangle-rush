import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { DekerSim } from '../src/core/deker';
import { EventQueue, type GameEvent } from '../src/core/events';
import type { Game } from '../src/core/game';
import { BEST_DEKER_KEY, BEST_KEY, type Difficulty } from '../src/core/settings';
import { createPuckSample, type PuckSample } from '../src/core/types';
import { headAt, makeGame, press, run, standing, startPlaying } from './helpers';

const DT = CONFIG.sim.fixedDt;
const D = CONFIG.deker;
/** Stred podložky: puk tu čaká, kým sa nerozsvieti svetlo (svetlo sa rozsvieti aspoň minJump odtiaľto). */
const AWAY = { x: 0, z: -D.mat.centerDistance };

function makeSim(seed = 1, difficulty: Difficulty = 'easy') {
  const events = new EventQueue();
  const sim = new DekerSim(CONFIG, events);
  sim.reset(seed, difficulty);
  return { sim, events };
}

function puckAt(x: number, z: number, age = 0): PuckSample {
  return { valid: true, x, z, age };
}

/** Puk, ktorý príde na svietiace svetlo `delay` s po jeho rozsvietení (inak leží v strede podložky). */
function follow(sim: DekerSim, delay: number): PuckSample {
  if (sim.lit && sim.targetAge >= delay) return puckAt(sim.targetX, sim.targetZ);
  return puckAt(AWAY.x, AWAY.z);
}

type PuckInput = PuckSample | ((sim: DekerSim) => PuckSample);

/** Krokuje simuláciu `seconds` a vráti kópie udalostí. */
function advance(sim: DekerSim, events: EventQueue, seconds: number, puck?: PuckInput): GameEvent[] {
  const out: GameEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    sim.step(DT, typeof puck === 'function' ? puck(sim) : puck);
    events.drain((e) => out.push({ ...e }));
  }
  return out;
}

/** Krokuje a zapisuje polohy rozsvietených svetiel. */
function lights(sim: DekerSim, events: EventQueue, seconds: number, puck?: PuckInput): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    sim.step(DT, typeof puck === 'function' ? puck(sim) : puck);
    events.drain((e) => {
      if (e.type === 'dekerTarget') out.push({ x: sim.targetX, z: sim.targetZ });
    });
  }
  return out;
}

/** Krokuje, kým sa nerozsvieti svetlo (vráti jeho poradie). */
function untilLit(sim: DekerSim, events: EventQueue, puck?: PuckInput): number {
  for (let i = 0; i < 10000 && !sim.lit; i++) advance(sim, events, DT, puck);
  return sim.shown;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('Deker: svetlá', () => {
  it('prvé svetlo sa rozsvieti po firstDelay', () => {
    const { sim, events } = makeSim();
    advance(sim, events, D.firstDelay - 2 * DT);
    expect(sim.lit).toBe(false);
    const e = advance(sim, events, 3 * DT);
    expect(sim.lit).toBe(true);
    expect(e.filter((x) => x.type === 'dekerTarget').map((x) => x.n)).toEqual([1]);
  });

  it('svetlo je na náhodnom mieste podložky, vždy aspoň minJump od predošlého; bez puku v rytme bez bodov', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { sim, events } = makeSim(seed);
      const seq = lights(sim, events, D.roundTime + 1);
      for (const p of seq) {
        expect(p.x).toBeGreaterThanOrEqual(sim.minX);
        expect(p.x).toBeLessThanOrEqual(sim.maxX);
        expect(p.z).toBeGreaterThanOrEqual(sim.minZ);
        expect(p.z).toBeLessThanOrEqual(sim.maxZ);
      }
      for (let i = 1; i < seq.length; i++) expect(dist(seq[i]!, seq[i - 1]!)).toBeGreaterThanOrEqual(D.minJump);
      // Rytmus: svetlo svieti celý limit, potom krátka medzera.
      expect(seq.length).toBe(Math.ceil((D.roundTime - D.firstDelay) / (sim.timeout + D.gapTime)));
      expect(sim.passes).toBe(seq.length - (sim.lit ? 1 : 0));
      expect(sim.score).toBe(0);
      expect(sim.misses).toBe(0);
      expect(sim.finished).toBe(true);
    }
  });

  it('svetlá pokryjú celú podložku, nie len pár pevných miest', () => {
    const all: { x: number; z: number }[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const { sim, events } = makeSim(seed, 'pro');
      all.push(...lights(sim, events, D.roundTime));
    }
    const { sim } = makeSim();
    const near = 0.12;
    expect(all.some((p) => p.x < sim.minX + near)).toBe(true);
    expect(all.some((p) => p.x > sim.maxX - near)).toBe(true);
    expect(all.some((p) => p.z < sim.minZ + near)).toBe(true);
    expect(all.some((p) => p.z > sim.maxZ - near)).toBe(true);
    expect(all.some((p) => Math.abs(p.x) < near)).toBe(true);
    // Rôzne miesta (na centimetre).
    expect(new Set(all.map((p) => `${Math.round(p.x * 100)}:${Math.round(p.z * 100)}`)).size).toBeGreaterThan(all.length * 0.9);
  });

  it('rovnaký seed dá rovnaké svetlá', () => {
    const a = makeSim(5);
    const b = makeSim(5);
    const c = makeSim(6);
    const la = lights(a.sim, a.events, 30);
    expect(lights(b.sim, b.events, 30)).toEqual(la);
    expect(lights(c.sim, c.events, 30)).not.toEqual(la);
  });

  it('svetlo sa nerozsvieti pri puku (aspoň minJump od neho)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { sim, events } = makeSim(seed);
      const puck = { x: 0.25 * ((seed % 5) - 2), z: -0.5 };
      const seq = lights(sim, events, D.roundTime, puckAt(puck.x, puck.z));
      expect(seq.length).toBeGreaterThan(5);
      for (const p of seq) expect(dist(p, puck)).toBeGreaterThanOrEqual(D.minJump);
    }
  });

  it('miesto pre svetlá je na podložke a dosť veľké na skok minJump', () => {
    const { sim } = makeSim();
    const { width, depth, centerDistance } = D.mat;
    expect(sim.minX - D.padRadius).toBeGreaterThanOrEqual(-width / 2);
    expect(sim.maxX + D.padRadius).toBeLessThanOrEqual(width / 2);
    expect(sim.minZ - D.padRadius).toBeGreaterThanOrEqual(-centerDistance - depth / 2);
    expect(sim.maxZ + D.padRadius).toBeLessThanOrEqual(-centerDistance + depth / 2);
    // Nové svetlo nikdy nie je pod pukom a z ktoréhokoľvek miesta sa dá skočiť aspoň o minJump.
    expect(D.minJump).toBeGreaterThan(D.hitRadius);
    expect(sim.maxX - sim.minX).toBeGreaterThan(2 * D.minJump);
    expect(sim.maxZ - sim.minZ).toBeGreaterThan(D.minJump);
  });
});

describe('Deker: zásahy a body', () => {
  it('puk na svetle: zásah, body, combo a reakcia; potom ďalšie svetlo', () => {
    const { sim, events } = makeSim();
    const lit = untilLit(sim, events, puckAt(AWAY.x, AWAY.z));
    const at = { x: sim.targetX, z: sim.targetZ };
    const e = advance(sim, events, 0.5, (s) => follow(s, 0.3));
    const hit = e.find((x) => x.type === 'dekerHit');
    expect(hit?.n).toBe(lit);
    expect({ x: sim.lastX, z: sim.lastZ }).toEqual(at);
    expect(sim.hits).toBe(1);
    expect(sim.combo).toBe(1);
    expect(sim.score).toBeGreaterThan(D.scorePerHit);
    expect(sim.reactionSum).toBeCloseTo(0.3, 1);
    expect(untilLit(sim, events, puckAt(AWAY.x, AWAY.z))).toBe(lit + 1);
    expect(dist({ x: sim.targetX, z: sim.targetZ }, at)).toBeGreaterThanOrEqual(D.minJump);
  });

  it('rýchlejší zásah dá viac bodov', () => {
    const score = (delay: number) => {
      const { sim, events } = makeSim(3);
      untilLit(sim, events, puckAt(AWAY.x, AWAY.z));
      advance(sim, events, delay + 0.1, (s) => follow(s, delay));
      expect(sim.hits).toBe(1);
      return sim.score;
    };
    const fast = score(0.2);
    const slow = score(2.5);
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThanOrEqual(D.scorePerHit * (1 + D.speedBonus));
    expect(slow).toBeGreaterThanOrEqual(D.scorePerHit);
  });

  it('séria zásahov zvýši násobiteľ (combo)', () => {
    const { sim, events } = makeSim(9);
    const step = CONFIG.rules.comboStep;
    let before = 0;
    let gain = 0;
    for (let i = 0; i <= step; i++) {
      untilLit(sim, events, puckAt(AWAY.x, AWAY.z));
      before = sim.score;
      advance(sim, events, 0.3, (s) => follow(s, 0.2));
      gain = sim.score - before;
    }
    expect(sim.combo).toBe(step + 1);
    expect(sim.maxCombo).toBe(step + 1);
    // Zásah po comboStep zásahoch je za ×2.
    expect(gain).toBeGreaterThan(1.9 * D.scorePerHit * (1 + D.speedBonus * (1 - 0.2 / sim.timeout)) - 2);
  });

  it('záber puku spred rozsvietenia sa neráta', () => {
    const { sim, events } = makeSim(4);
    untilLit(sim, events, puckAt(AWAY.x, AWAY.z));
    const p = { x: sim.targetX, z: sim.targetZ };
    // Kamera ukazuje puk na svetle, ale záber je 0,35 s starý (urobený ešte pred rozsvietením).
    advance(sim, events, 0.2, puckAt(p.x, p.z, 0.35));
    expect(sim.hits).toBe(0);
    advance(sim, events, 0.25, puckAt(p.x, p.z, 0.35));
    expect(sim.hits).toBe(1);
    expect(sim.reactionSum).toBeLessThan(0.1);
  });

  it('limit vypršal, hoci kamera puk videla: minutie a combo sa vynuluje', () => {
    const { sim, events } = makeSim(2);
    untilLit(sim, events, puckAt(AWAY.x, AWAY.z));
    advance(sim, events, 0.3, (s) => follow(s, 0.2));
    expect(sim.combo).toBe(1);
    const lit = untilLit(sim, events, puckAt(AWAY.x, AWAY.z));
    const e = advance(sim, events, sim.timeout + DT, puckAt(AWAY.x, AWAY.z));
    expect(e.find((x) => x.type === 'dekerMiss')?.n).toBe(lit);
    expect(sim.misses).toBe(1);
    expect(sim.combo).toBe(0);
    expect(sim.maxCombo).toBe(1);
  });

  it('limit vypršal bez puku: prechod bez bodov, combo ostane', () => {
    const { sim, events } = makeSim(2);
    untilLit(sim, events, puckAt(AWAY.x, AWAY.z));
    advance(sim, events, 0.3, (s) => follow(s, 0.2));
    const score = sim.score;
    untilLit(sim, events);
    const e = advance(sim, events, sim.timeout + DT);
    expect(e.some((x) => x.type === 'dekerPass')).toBe(true);
    expect(sim.passes).toBe(1);
    expect(sim.misses).toBe(0);
    expect(sim.combo).toBe(1);
    expect(sim.score).toBe(score);
  });

  it('limit na svetlo závisí od obtiažnosti', () => {
    for (const d of ['warmup', 'easy', 'medium', 'hard', 'pro'] as const) {
      expect(makeSim(1, d).sim.timeout).toBe(D.targetTime[d]);
    }
    expect(D.targetTime.pro).toBeLessThan(D.targetTime.warmup);
  });
});

/** Puk pre hru: ide na svietiace svetlo 0,4 s po rozsvietení. */
function gamePuck(game: Game, out: PuckSample = createPuckSample()): PuckSample {
  const p = follow(game.deker, 0.4);
  out.valid = true;
  out.x = p.x;
  out.z = p.z;
  out.age = 0;
  return out;
}

const looking = () => headAt(0, 1.5, 0, 0, -60);

function startDeker(game: Game): void {
  run(game, 0.1, standing());
  press(game, 'startDeker');
  run(game, game.settings.countdown + 0.1, looking());
  if (game.state !== 'PLAYING') throw new Error(`Očakávaný PLAYING, je ${game.state}`);
}

function playDeker(game: Game, until: number): void {
  const puck = createPuckSample();
  for (let i = 0; i < 100000 && game.state === 'PLAYING' && game.deker.time < until - 1e-9; i++) {
    game.update(DT, looking(), gamePuck(game, puck));
  }
  game.events.clear();
}

describe('Deker v hre', () => {
  it('z menu → odpočet → kolo 60 s → GAME_OVER s rekordom Dekera (rekord DangleRush ostane)', () => {
    const { game, storage } = makeGame();
    run(game, 0.1, standing());
    press(game, 'startDeker');
    expect(game.state).toBe('COUNTDOWN');
    expect(game.mode).toBe('deker');
    expect(game.dekerOn).toBe(true);
    run(game, game.settings.countdown + 0.1, looking());
    expect(game.state).toBe('PLAYING');
    playDeker(game, D.roundTime + 1);
    expect(game.state).toBe('GAME_OVER');
    const r = game.result!;
    expect(r.mode).toBe('deker');
    expect(r.time).toBeCloseTo(D.roundTime, 1);
    expect(r.targetsHit).toBeGreaterThan(10);
    expect(r.targetsJudged).toBe(r.targetsHit);
    expect(r.avgHitTime).toBeCloseTo(0.4, 1);
    expect(r.score).toBe(Math.floor(game.deker.score));
    expect(r.newBest).toBe(true);
    expect(game.bestDeker.easy).toBe(r.score);
    expect(game.best.easy).toBe(0);
    expect(JSON.parse(storage.getItem(BEST_DEKER_KEY)!).easy).toBe(r.score);
    expect(storage.getItem(BEST_KEY)).toBeNull();
    // Simulácia DangleRush stála: žiadne prekážky.
    expect(game.sim.time).toBe(0);
    expect(game.sim.obstacles.some((o) => o.active)).toBe(false);
    expect(game.layout.buttons.map((b) => b.id)).toEqual(['newGame', 'menu', 'settings']);
  });

  it('Nová hra spustí znova Deker, Menu sa vráti do hlavného menu', () => {
    const { game } = makeGame();
    startDeker(game);
    playDeker(game, D.roundTime + 1);
    press(game, 'newGame');
    expect(game.state).toBe('COUNTDOWN');
    expect(game.mode).toBe('deker');
    expect(game.deker.time).toBe(0);
    expect(game.result).toBeNull();
    run(game, game.settings.countdown + 0.1, looking());
    playDeker(game, D.roundTime + 1);
    press(game, 'menu');
    expect(game.state).toBe('READY');
    expect(game.dekerOn).toBe(false);
    expect(game.layout.id).toBe('ready');
  });

  it('Menu z pauzy zahodí rozohranú hru DangleRush aj s prekážkami', () => {
    const { game } = makeGame();
    startPlaying(game);
    run(game, 6, headAt(0, 1.2, 0, 0, -50));
    expect(game.sim.obstacles.some((o) => o.active)).toBe(true);
    game.autoPause('visibility');
    press(game, 'menu');
    expect(game.state).toBe('READY');
    expect(game.sim.obstacles.some((o) => o.active)).toBe(false);
    expect(game.best.easy).toBe(0);
    // Potom Deker: žiadne zvyšky z DangleRush.
    press(game, 'startDeker');
    expect(game.sim.headUp.enabled).toBe(false);
    expect(game.sim.obstacles.some((o) => o.active)).toBe(false);
  });

  it('pauza zmrazí kolo a pokračovanie ide presne odtiaľ (rovnaký priebeh ako bez pauzy)', () => {
    const a = makeGame({ seed: 42 }).game;
    startDeker(a);
    playDeker(a, 20);

    const b = makeGame({ seed: 42 }).game;
    startDeker(b);
    playDeker(b, 8);
    b.autoPause('visibility');
    const frozen = b.deker.snapshot();
    run(b, 5, standing(70, 0));
    expect(b.deker.snapshot()).toEqual(frozen);
    press(b, 'resume');
    // Odpočet po snímkoch fixného kroku: kolo pokračuje hneď s pukom (ako v behu bez pauzy).
    for (let i = 0; i < 1000 && b.state !== 'PLAYING'; i++) b.update(DT, looking(), gamePuck(b));
    expect(b.state).toBe('PLAYING');
    expect(b.deker.snapshot()).toEqual(frozen);
    playDeker(b, 20);

    expect(b.deker.snapshot()).toEqual(a.deker.snapshot());
    expect(a.deker.hits).toBeGreaterThan(5);
  });
});
