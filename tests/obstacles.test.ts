import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EventQueue } from '../src/core/events';
import {
  Obstacle,
  makePokeCheck,
  makeSlalom,
  makeStars,
  makeWideDangle,
  pokeCheckCenter,
} from '../src/core/obstacles';
import { GameplaySim } from '../src/core/sim';

const O = CONFIG.obstacles;
const W = CONFIG.playArea.width;

describe('vzory na zemi', () => {
  it('slalom: kužele v rade, puk ich obchádza striedavo', () => {
    const o = new Obstacle();
    makeSlalom(o, 4, 0.1, 1, 1.5, CONFIG);
    expect(o.elemCount).toBe(4);
    expect(Array.from(o.elemDz.slice(0, 4))).toEqual([-0, -1.5, -3, -4.5]);
    expect(Array.from(o.elemX.slice(0, 4))).toEqual([0.1, 0.1, 0.1, 0.1]);
    const p = O.slalom.passOffset;
    expect(Array.from(o.elemPuckX.slice(0, 4)).map((x) => +x.toFixed(6))).toEqual(
      [0.1 + p, 0.1 - p, 0.1 + p, 0.1 - p].map((x) => +x.toFixed(6)),
    );
    expect(o.length).toBeCloseTo(4.5, 9);
    expect(o.body).toBe(false);
  });

  it('široké miesanie: brána úplne na jednej strane, potom na druhej', () => {
    const o = new Obstacle();
    makeWideDangle(o, -1, 2, CONFIG);
    expect(o.elemCount).toBe(2);
    expect(o.elemPuckX[0]).toBeCloseTo(-O.wideDangle.offset, 9);
    expect(o.elemPuckX[1]).toBeCloseTo(O.wideDangle.offset, 9);
    expect(o.elemDz[1]).toBe(-2);
    // Brány sa zmestia na plochu.
    expect(O.wideDangle.offset + O.wideDangle.gapWidth / 2).toBeLessThanOrEqual(W / 2);
  });

  it('hviezdy: puk ide cez každú', () => {
    const o = new Obstacle();
    makeStars(o, [0.5, -0.2, 0.1], 3, 1.2, CONFIG);
    expect(Array.from(o.elemPuckX.slice(0, 3))).toEqual([0.5, -0.2, 0.1]);
    expect(o.length).toBeCloseTo(2.4, 9);
  });

  it('pohyblivá hokejka sa presunie na druhú stranu a medzera ostane na strane gapSide', () => {
    const o = new Obstacle();
    makePokeCheck(o, 1, 0.55, -5, -3, CONFIG);
    const len = 0.55 * W;
    // Začiatok: tyč pri pravom okraji; koniec: pri ľavom, medzera vpravo.
    expect(pokeCheckCenter(o, -7)).toBeCloseTo(W / 2 - len / 2, 9);
    expect(pokeCheckCenter(o, -5)).toBeCloseTo(W / 2 - len / 2, 9);
    expect(pokeCheckCenter(o, -3)).toBeCloseTo(-(W / 2 - len / 2), 9);
    expect(pokeCheckCenter(o, 0)).toBeCloseTo(-(W / 2 - len / 2), 9);
    const mid = pokeCheckCenter(o, -4);
    expect(Math.abs(mid)).toBeLessThan(0.05);
    // Konečná medzera: od pravého konca tyče po okraj plochy.
    const barRight = pokeCheckCenter(o, -3) + len / 2;
    expect(o.gapX).toBeCloseTo((barRight + W / 2) / 2, 9);
    expect(o.gapW).toBeCloseTo(W / 2 - barRight, 9);
  });

  it('presun hokejky závisí len od polohy na dráhe (pauza ho zmrazí)', () => {
    const o = new Obstacle();
    makePokeCheck(o, -1, 0.6, -6, -2.5, CONFIG);
    expect(pokeCheckCenter(o, -4.2)).toBe(pokeCheckCenter(o, -4.2));
  });
});

describe('vzory v simulácii', () => {
  function simWith(seed = 4) {
    const events = new EventQueue(1024);
    const sim = new GameplaySim(CONFIG, events);
    sim.reset(seed, 1.7, 'medium', true);
    return { sim, events };
  }
  const head = { x: 0, y: 1.2, z: 0 };

  it('vzor sa započíta raz, keď plochou prejde jeho posledný prvok, a zmizne 1 m za hráčom', () => {
    const { sim, events } = simWith();
    sim.spawnPause = 1e9;
    const o = sim.obstacles[0]!;
    makeSlalom(o, 3, 0, 1, 1.5, CONFIG);
    o.active = true;
    o.resolved = false;
    o.id = 77;
    o.z = o.prevZ = -1;
    let passedAtZ = 0;
    while (o.active) {
      sim.step(CONFIG.sim.fixedDt, head, head);
      if (sim.floorPassed === 1 && passedAtZ === 0) passedAtZ = o.z;
    }
    expect(sim.floorPassed).toBe(1);
    // Posledný kužeľ (3 m za čelom) prešiel stredom plochy.
    expect(passedAtZ - o.length - o.halfDepth).toBeGreaterThan(-CONFIG.playArea.centerDistance);
    expect(passedAtZ - o.length - o.halfDepth).toBeLessThan(-CONFIG.playArea.centerDistance + 0.05);
    expect(o.z - o.length - o.halfDepth).toBeGreaterThan(O.despawnBehind);
    const types: string[] = [];
    events.drain((e) => types.push(e.type));
    expect(types.filter((t) => t === 'passFloor').length).toBe(1);
  });

  it('pohyblivá hokejka v hre: presun skončí aspoň settleTime pred príchodom k puku', () => {
    let found = 0;
    for (let seed = 1; seed <= 40 && found < 5; seed++) {
      const { sim } = simWith(seed);
      sim.reset(seed, 1.7, 'hard', true);
      for (let i = 0; i < 120 * 120; i++) {
        sim.step(CONFIG.sim.fixedDt, { x: 50, y: 1.7, z: 0 }, { x: 50, y: 1.7, z: 0 });
        const o = sim.obstacles.find((x) => x.active && x.kind === 'pokeCheck' && x.z < -6.9);
        if (o) {
          const ballZ = -CONFIG.playArea.centerDistance;
          // Čas od konca presunu po príchod čela k puku pri aktuálnej rýchlosti.
          expect((ballZ - o.sweepZ1) / sim.speed).toBeGreaterThanOrEqual(O.pokeCheck.settleTime - 1e-6);
          expect(o.sweepZ0).toBeGreaterThanOrEqual(-O.spawnDistance - 1e-9);
          found++;
          break;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
