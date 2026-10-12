import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { GameEvent } from '../src/core/events';
import { EventQueue } from '../src/core/events';
import {
  ELEM_HIT,
  ELEM_MISS,
  ELEM_UNKNOWN,
  MAX_ELEMENTS,
  makeConeGate,
  makeLowBar,
  makePokeCheck,
  makeSlalom,
  makeStars,
  puckPassesElement,
  type Obstacle,
} from '../src/core/obstacles';
import { GameplaySim } from '../src/core/sim';
import { createPuckSample, type PuckSample, type Vec3 } from '../src/core/types';
import { makeGame, run, standing, startPlaying } from './helpers';

const DT = CONFIG.sim.fixedDt;
const H = 1.7;
const HEAD: Vec3 = { x: 0, y: H, z: 0 };
const BALL_Z = -CONFIG.playArea.centerDistance;

function makeSim() {
  const events = new EventQueue(1024);
  const sim = new GameplaySim(CONFIG, events);
  sim.reset(5, H, 'medium', true);
  sim.spawnPause = 1e9;
  return { sim, events };
}

function place(sim: GameplaySim, z: number, make: (o: Obstacle) => void): Obstacle {
  const o = sim.obstacles.find((x) => !x.active)!;
  make(o);
  o.active = true;
  o.resolved = false;
  o.hit = false;
  o.id = 7;
  o.z = o.prevZ = z;
  return o;
}

function puckAt(x: number, z = BALL_Z, age = 0): PuckSample {
  return { valid: true, x, z, age };
}

/** Krokuje simuláciu; puk môže byť funkcia času. Vráti udalosti. */
function stepFor(sim: GameplaySim, events: EventQueue, seconds: number, puck: PuckSample | ((t: number) => PuckSample)) {
  const out: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    sim.step(DT, HEAD, HEAD, typeof puck === 'function' ? puck(i * DT) : puck);
    events.drain((e) => out.push({ ...e }));
  }
  return out;
}

describe('posúdenie prvkov na zemi pukom', () => {
  it('puk v bráne: úspech, body a combo; mimo brány: minutie a combo sa vynuluje', () => {
    const { sim, events } = makeSim();
    const gate = place(sim, -3, (o) => makeConeGate(o, 0.3, CONFIG));
    const evs = stepFor(sim, events, 2, puckAt(0.32));
    expect(gate.elemResult[0]).toBe(ELEM_HIT);
    expect(sim.floorHits).toBe(1);
    expect(sim.combo).toBe(1);
    expect(sim.score).toBeGreaterThan(CONFIG.puck.scorePerHit);
    const hit = evs.find((e) => e.type === 'floorHit')!;
    expect(hit.n).toBe(gate.id * MAX_ELEMENTS);

    const miss = place(sim, -3, (o) => makeConeGate(o, 0.3, CONFIG));
    miss.id = 8;
    const evs2 = stepFor(sim, events, 2, puckAt(-0.3));
    expect(miss.elemResult[0]).toBe(ELEM_MISS);
    expect(sim.floorMisses).toBe(1);
    expect(sim.combo).toBe(0);
    expect(evs2.some((e) => e.type === 'floorMiss')).toBe(true);
  });

  it('bez puku sa prvok neposudzuje, len prejde plochou', () => {
    const { sim, events } = makeSim();
    const gate = place(sim, -3, (o) => makeConeGate(o, 0.3, CONFIG));
    const evs = stepFor(sim, events, 2, createPuckSample());
    expect(gate.elemResult[0]).toBe(ELEM_UNKNOWN);
    expect(sim.floorHits + sim.floorMisses).toBe(0);
    expect(evs.some((e) => e.type === 'floorPass')).toBe(true);
    expect(evs.find((e) => e.type === 'passFloor')!.n).toBe(0);
  });

  it('oneskorenie kamery: prvok sa posúdi až keď ho puk „uvidí“ za čiarou', () => {
    const { sim, events } = makeSim();
    const gate = place(sim, -3, (o) => makeConeGate(o, 0, CONFIG));
    const age = 0.1;
    let judgedAt = NaN;
    for (let i = 0; i < 400 && Number.isNaN(judgedAt); i++) {
      sim.step(DT, HEAD, HEAD, puckAt(0, BALL_Z, age));
      if (gate.elemResult[0] !== 0) judgedAt = gate.z;
      events.clear();
    }
    // Čelo prekážky je o rýchlosť × vek za čiarou puku (± jeden krok).
    expect(judgedAt - BALL_Z).toBeGreaterThanOrEqual(sim.speed * age - 1e-9);
    expect(judgedAt - BALL_Z).toBeLessThan(sim.speed * age + sim.speed * DT + 1e-9);
  });

  it('starý odhad puku sa nepoužije', () => {
    const { sim, events } = makeSim();
    const gate = place(sim, -3, (o) => makeConeGate(o, 0, CONFIG));
    stepFor(sim, events, 2, puckAt(0, BALL_Z, CONFIG.puck.maxAge + 0.1));
    expect(gate.elemResult[0]).toBe(ELEM_UNKNOWN);
  });

  it('slalom: puk striedavo zo správnej strany kužeľov, raz zo zlej', () => {
    const { sim, events } = makeSim();
    const spacing = 1.2;
    const o = place(sim, -3, (x) => makeSlalom(x, 4, 0, -1, spacing, CONFIG));
    // Puk ide k strane prvku, ktorý je najbližšie pred ním; pri treťom kuželi schválne zle.
    const puck = () => {
      for (let i = 0; i < o.elemCount; i++) {
        if (o.elemResult[i] === 0) {
          const wrong = i === 2;
          return puckAt(wrong ? -o.elemPuckX[i]! : o.elemPuckX[i]!);
        }
      }
      return puckAt(0);
    };
    stepFor(sim, events, 4, puck);
    expect(Array.from(o.elemResult.subarray(0, 4))).toEqual([ELEM_HIT, ELEM_HIT, ELEM_MISS, ELEM_HIT]);
    expect(sim.floorHits).toBe(3);
    expect(sim.combo).toBe(1);
  });

  it('hviezda, nízka tyč a pohyblivá hokejka', () => {
    const { sim } = makeSim();
    const stars = sim.obstacles[0]!;
    makeStars(stars, [0.4], 1, 1, CONFIG);
    expect(puckPassesElement(stars, 0, 0.4 + CONFIG.obstacles.stars.radius, CONFIG)).toBe(true);
    expect(puckPassesElement(stars, 0, 0.1, CONFIG)).toBe(false);

    const bar = sim.obstacles[1]!;
    makeLowBar(bar, -1, 0.6, CONFIG); // tyč zľava, medzera vpravo
    expect(puckPassesElement(bar, 0, bar.x1 + 0.05, CONFIG)).toBe(true);
    expect(puckPassesElement(bar, 0, bar.x1 - 0.2, CONFIG)).toBe(false);

    const poke = sim.obstacles[2]!;
    makePokeCheck(poke, 1, 0.55, -3, -1, CONFIG); // medzera vpravo na konci
    const end = poke.sweepTo + (poke.x1 - poke.x0) / 2;
    expect(puckPassesElement(poke, 0, end + 0.05, CONFIG)).toBe(true);
    expect(puckPassesElement(poke, 0, end - 0.2, CONFIG)).toBe(false);
  });
});

describe('puk v hre', () => {
  it('Game.update odovzdá puk simulácii: puk vždy tam, kam ukazujú prekážky, dá samé úspechy', () => {
    const { game } = makeGame({ seed: 21 });
    game.settings.difficulty = 'easy';
    startPlaying(game);
    const sim = game.sim;
    const puck = createPuckSample();
    // Autopilot puku: najbližší neposúdený prvok pred čiarou puku určí x.
    const at = () => {
      let best = -Infinity;
      puck.valid = true;
      puck.z = BALL_Z;
      puck.age = 0;
      for (const o of sim.obstacles) {
        if (!o.active || o.body) continue;
        for (let i = 0; i < o.elemCount; i++) {
          const z = o.z + o.elemDz[i]!;
          if (o.elemResult[i] !== 0 || z > BALL_Z + 0.02 || z <= best) continue;
          best = z;
          puck.x = o.elemPuckX[i]!;
        }
      }
      return puck;
    };
    const head = standing(0, -40);
    for (let i = 0; i < Math.round(40 / (1 / 90)); i++) {
      game.update(1 / 90, head, at());
      game.events.clear();
      if (game.state !== 'PLAYING') break;
    }
    expect(sim.floorHits).toBeGreaterThan(5);
    expect(sim.floorMisses).toBe(0);
  });

  it('bez puku sa hrá ako doteraz (žiadne posúdenie)', () => {
    const { game } = makeGame({ seed: 21 });
    startPlaying(game);
    run(game, 20, standing(0, -40));
    expect(game.sim.floorHits + game.sim.floorMisses).toBe(0);
    expect(game.sim.floorPassed).toBeGreaterThan(0);
  });
});
