import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EventQueue, type GameEvent } from '../src/core/events';
import { Game } from '../src/core/game';
import { HeadUpDrill } from '../src/core/headUp';
import { pauseAnchor } from '../src/core/layout';
import { makeLowBar } from '../src/core/obstacles';
import { MemoryStorage, SETTINGS_KEY, loadSettings } from '../src/core/settings';
import { GameplaySim } from '../src/core/sim';
import type { Vec3 } from '../src/core/types';
import { EYE, headAt, makeGame, press, run, standing, startPlaying } from './helpers';

const DT = CONFIG.sim.fixedDt;
const DEG = Math.PI / 180;
const C = CONFIG.headUp;
const BALL_Z = -CONFIG.playArea.centerDistance;
/** Hráč v postoji: hlava nízko, pohľad dole na puk (sklon −50°). */
const HEAD: Vec3 = { x: 0, y: 1.3, z: 0 };
const DOWN: Vec3 = { x: 0, y: -Math.sin(50 * DEG), z: -Math.cos(50 * DEG) };
/** Pohľad do strany na horizont: hlava hore, ale ďaleko od spoluhráča (ten je najviac 30° od smeru hry). */
const SIDEWAYS: Vec3 = { x: -1, y: 0, z: 0 };

function makeSim(seed = 3) {
  const events = new EventQueue(1024);
  const sim = new GameplaySim(CONFIG, events);
  sim.reset(seed, EYE, 'medium', true, true);
  return { sim, events };
}

/** Jednotkový smer z hlavy na značku spoluhráča. */
function towardMate(sim: GameplaySim): Vec3 {
  const d = sim.headUp;
  const x = d.x - HEAD.x;
  const y = d.y - HEAD.y;
  const z = d.z - HEAD.z;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

/** Krokuje, kým nepríde udalosť typu `type` (alebo neprejde maxSeconds); vráti herný čas udalosti. */
function stepUntil(
  sim: GameplaySim,
  events: EventQueue,
  type: GameEvent['type'],
  fwd: (sim: GameplaySim) => Vec3,
  maxSeconds = 20,
): number {
  let found = -1;
  for (let i = 0; i < Math.round(maxSeconds / DT) && found < 0; i++) {
    sim.step(DT, HEAD, HEAD, undefined, fwd(sim));
    events.drain((e) => {
      if (e.type === type && found < 0) found = sim.time;
    });
  }
  return found;
}

/** Nízka tyč, ktorej prvok príde k čiare puku približne v čase `arrival` (pri štartovej rýchlosti). */
function placeLowBar(sim: GameplaySim, arrival: number): void {
  const o = sim.obstacles.find((x) => !x.active)!;
  makeLowBar(o, -1, 0.6, CONFIG);
  o.active = true;
  o.resolved = false;
  o.hit = false;
  o.id = 1000 + sim.obstacles.indexOf(o);
  o.z = o.prevZ = BALL_Z - sim.speed * arrival;
}

describe('hlava hore: spoluhráč', () => {
  it('príde po firstDelay a pohľad naňho dá body, combo a plný prehľad', () => {
    const { sim, events } = makeSim();
    sim.spawnPause = 1e9;
    const shown = stepUntil(sim, events, 'signal', () => DOWN);
    expect(shown).toBeCloseTo(C.firstDelay, 1);
    expect(sim.headUp.active).toBe(true);
    expect(sim.headUp.awareness).toBeLessThan(1);

    const seen = stepUntil(sim, events, 'signalSeen', towardMate, 1);
    expect(seen - shown).toBeGreaterThanOrEqual(C.lookTime - 1e-6);
    expect(seen - shown).toBeLessThan(C.lookTime + 3 * DT);
    expect(sim.headUp.seen).toBe(1);
    expect(sim.headUp.active).toBe(false);
    expect(sim.headUp.awareness).toBe(1);
    expect(sim.combo).toBe(1);
    expect(sim.score - CONFIG.rules.timeBonusPerSecond * sim.time).toBeCloseTo(C.scorePerSignal, 6);
  });

  it('bez pohľadu sa po showTime zmešká a prehľad klesne o missPenalty', () => {
    const { sim, events } = makeSim();
    sim.spawnPause = 1e9;
    const shown = stepUntil(sim, events, 'signal', () => DOWN);
    const showTime = sim.headUp.showTime;
    expect(showTime).toBeLessThanOrEqual(C.showTimeMax);
    expect(showTime).toBeGreaterThanOrEqual(C.showTimeMin);
    // Kúsok pred koncom ešte čaká, potom sa zmešká.
    let before = 0;
    let missed = -1;
    for (let i = 0; i < Math.round(3 / DT) && missed < 0; i++) {
      before = sim.headUp.awareness;
      sim.step(DT, HEAD, HEAD, undefined, DOWN);
      events.drain((e) => {
        if (e.type === 'signalMissed') missed = sim.time;
      });
    }
    expect(missed - shown).toBeCloseTo(showTime, 1);
    expect(sim.headUp.missed).toBe(1);
    expect(sim.headUp.awareness).toBeCloseTo(Math.max(0, before - C.drainPerSecond * DT - C.missPenalty), 9);
    expect(sim.combo).toBe(0);
    expect(sim.score).toBeCloseTo(CONFIG.rules.timeBonusPerSecond * sim.time, 6);
  });

  it('pri pohľade hore kamera stratí puk: spoluhráč počká, kým prvok na zemi prejde čiarou puku', () => {
    const { sim, events } = makeSim();
    sim.spawnPause = 1e9;
    placeLowBar(sim, C.firstDelay + 0.4);
    let passedAt = -1;
    let shownAt = -1;
    for (let i = 0; i < Math.round(8 / DT) && shownAt < 0; i++) {
      sim.step(DT, HEAD, HEAD, undefined, DOWN);
      events.drain((e) => {
        if (e.type === 'floorPass') passedAt = sim.time;
        if (e.type === 'signal') shownAt = sim.time;
      });
    }
    expect(passedAt).toBeGreaterThan(C.firstDelay);
    expect(shownAt).toBeGreaterThan(C.firstDelay + 0.1);
    expect(shownAt).toBeCloseTo(passedAt, 6);
  });

  it('bez medzery medzi prvkami príde najneskôr maxWait po termíne', () => {
    const { sim, events } = makeSim();
    sim.spawnPause = 1e9;
    // Prvky prichádzajú každých 0,5 s (menej ako clearTime), takže medzera nikdy nenastane.
    for (let t = 3; t < 10; t += 0.5) placeLowBar(sim, t);
    const shown = stepUntil(sim, events, 'signal', () => DOWN);
    expect(shown).toBeGreaterThanOrEqual(C.firstDelay + C.maxWait - 1e-6);
    expect(shown).toBeLessThan(C.firstDelay + C.maxWait + 2 * DT);
  });

  // HUD je v smere hry (±7°), preto je značka vždy aspoň azimuthMinDeg bokom.
  it('značka je mimo HUD a ďaleko od tlačidla Pauza (bok vľavo, vpravo aj hore)', () => {
    const events = new EventQueue(16);
    const drill = new HeadUpDrill(CONFIG, events);
    const pauses = [
      pauseAnchor({ eyeHeight: EYE, setupHeight: EYE, pauseSide: 'left', pausePosition: 'side' }, CONFIG),
      pauseAnchor({ eyeHeight: EYE, setupHeight: EYE, pauseSide: 'right', pausePosition: 'side' }, CONFIG),
      pauseAnchor({ eyeHeight: EYE, setupHeight: EYE, pauseSide: 'right', pausePosition: 'top' }, CONFIG),
    ];
    const eye = { x: 0, y: EYE, z: 0 };
    const dir = (p: Vec3) => {
      const len = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
      return { x: (p.x - eye.x) / len, y: (p.y - eye.y) / len, z: (p.z - eye.z) / len };
    };
    const sides = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      drill.reset(seed, true);
      drill.step(DT, C.firstDelay, 0.5, EYE, eye, DOWN, Infinity);
      expect(drill.active).toBe(true);
      const az = Math.abs(drill.azDeg);
      expect(az).toBeGreaterThanOrEqual(C.azimuthMinDeg);
      expect(az).toBeLessThanOrEqual(C.azimuthMaxDeg);
      sides.add(Math.sign(drill.azDeg));
      const m = dir(drill);
      expect(Math.asin(m.y) / DEG).toBeCloseTo(C.elevationDeg, 6);
      for (const p of pauses) {
        const a = dir({ x: p.cx, y: p.cy, z: p.cz });
        const angle = Math.acos(m.x * a.x + m.y * a.y + m.z * a.z) / DEG;
        expect(angle).toBeGreaterThan(25);
      }
    }
    expect(sides).toEqual(new Set([-1, 1]));
  });
});

describe('hlava hore: prehľad a zatmavenie', () => {
  it('s hlavou dole klesá, pri pohľade hore sa dopĺňa; podlaha tmavne až pod darkenBelow', () => {
    const { sim } = makeSim();
    sim.spawnPause = 1e9;
    for (let i = 0; i < Math.round(3 / DT); i++) sim.step(DT, HEAD, HEAD, undefined, DOWN);
    expect(sim.headUp.awareness).toBeCloseTo(1 - 3 * C.drainPerSecond, 6);
    expect(sim.headUp.darkness()).toBe(0);
    for (let i = 0; i < Math.round(2 / DT); i++) sim.step(DT, HEAD, HEAD, undefined, DOWN);
    expect(sim.headUp.awareness).toBeCloseTo(1 - 5 * C.drainPerSecond, 6);
    const dark = sim.headUp.darkness();
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(1);
    for (let i = 0; i < Math.round(0.2 / DT); i++) sim.step(DT, HEAD, HEAD, undefined, SIDEWAYS);
    expect(sim.headUp.awareness).toBeCloseTo(1 - 5 * C.drainPerSecond + 0.2 * C.refillPerSecond, 6);
    for (let i = 0; i < Math.round(1 / DT); i++) sim.step(DT, HEAD, HEAD, undefined, SIDEWAYS);
    expect(sim.headUp.awareness).toBe(1);
    expect(sim.headUp.darkness()).toBe(0);
    sim.headUp.awareness = 0;
    expect(sim.headUp.darkness()).toBe(1);
  });

  it('priame testy simulácie bez hlavy hore: prehľad ostáva 1, spoluhráč nepríde', () => {
    const events = new EventQueue(1024);
    const sim = new GameplaySim(CONFIG, events);
    sim.reset(3, EYE, 'medium', true);
    let signals = 0;
    for (let i = 0; i < Math.round(12 / DT); i++) {
      sim.step(DT, { x: 50, y: EYE, z: 0 }, { x: 50, y: EYE, z: 0 });
      events.drain((e) => {
        if (e.type === 'signal') signals++;
      });
    }
    expect(signals).toBe(0);
    expect(sim.headUp.awareness).toBe(1);
    expect(sim.headUp.darkness()).toBe(0);
  });
});

describe('hlava hore v hre', () => {
  const crouched = () => headAt(0, 1.2, 0, 0, -50);

  it('je predvolene zapnutá: s hlavou dole spoluhráča zmešká a výsledok ho započíta', () => {
    const { game } = makeGame({ seed: 11 });
    expect(game.settings.headUp).toBe(true);
    startPlaying(game);
    const events = run(game, 12, crouched());
    expect(events.some((e) => e.type === 'signal')).toBe(true);
    expect(events.some((e) => e.type === 'signalMissed')).toBe(true);
    expect(game.sim.headUp.missed).toBeGreaterThan(0);
    expect(game.sim.headUp.darkness()).toBeGreaterThan(0);
  });

  it('dá sa vypnúť v nastaveniach (uloží sa) a vypnutá nepošle spoluhráča ani nezatmaví podlahu', () => {
    const { game, storage } = makeGame();
    run(game, 0.1, standing());
    press(game, 'settings');
    press(game, 'set.headUp');
    expect(game.settings.headUp).toBe(false);
    expect(loadSettings(storage, CONFIG).headUp).toBe(false);
    press(game, 'set.back');

    const off = new Game({ storage, seed: 5 });
    startPlaying(off);
    const events = run(off, 12, crouched());
    expect(events.some((e) => e.type === 'signal')).toBe(false);
    expect(off.sim.headUp.awareness).toBe(1);
    expect(off.sim.headUp.darkness()).toBe(0);
  });

  it('zmeškaní aj zachytení spoluhráči sú vo výsledku hry', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ eyeHeight: EYE }));
    const game = new Game({ storage, seed: 9 });
    startPlaying(game);
    // Hráč sa nehýbe a stojí v strede: obrancovia ho postupne zrazia až do konca hry.
    run(game, 240, crouched());
    expect(game.state).toBe('GAME_OVER');
    const r = game.result!;
    expect(r.signalsTotal).toBe(game.sim.headUp.seen + game.sim.headUp.missed);
    expect(r.signalsTotal).toBeGreaterThan(0);
    expect(r.signalsSeen).toBe(0);
  });
});
