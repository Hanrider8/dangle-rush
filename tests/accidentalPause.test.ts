/**
 * Tlačidlo Pauza sa nesmie spustiť samo pri bežnom hraní: hráč sleduje prekážky na dráhe,
 * pozerá na loptičku kdekoľvek na ploche, zohýba sa, robí úkroky a hlava sa jemne chveje.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG, type Config } from '../src/config';
import { Rng } from '../src/core/rng';
import { SETTINGS_KEY } from '../src/core/settings';
import { createHeadSample } from '../src/core/types';
import { Game } from '../src/core/game';
import { MemoryStorage } from '../src/core/settings';
import { EYE, lookingAt, press, run, standing } from './helpers';

const DT = 1 / 90;
const MINUTES = 5;

/** Nesmrteľný hráč, aby simulácia bežala celých 5 minút. */
const immortal: Config = { ...CONFIG, rules: { ...CONFIG.rules, lives: 1_000_000 } };

function makeGame(pauseSide: 'left' | 'right', pausePosition: 'side' | 'top') {
  const storage = new MemoryStorage();
  storage.setItem(SETTINGS_KEY, JSON.stringify({ eyeHeight: EYE, pauseSide, pausePosition }));
  return new Game({ storage, seed: 99, config: immortal });
}

/**
 * Plynulý pohyb hlavy medzi cieľmi pohľadu (loptička na ploche, prekážky na dráhe,
 * krátke pohľady okolo) s úkrokmi, zohýbaním a chvením.
 */
function normalPlay(seed: number) {
  const rng = new Rng(seed);
  const head = createHeadSample();
  const pos = { x: 0, y: 1.45, z: 0 };
  const target = { x: 0, y: 0, z: -0.55 };
  const goal = { x: 0, y: 0, z: -0.55 };
  const look = { x: 0, y: 0, z: 0 };
  let nextSwitch = 0;
  let dodgeX = 0;
  let duck = 0;
  let nextMove = 0;
  return (t: number) => {
    if (t >= nextSwitch) {
      const r = rng.next();
      if (r < 0.55) {
        // loptička kdekoľvek na ploche (aj v rohoch)
        goal.x = rng.range(-0.7, 0.7);
        goal.y = 0.03;
        goal.z = rng.range(-1.05, -0.05);
      } else if (r < 0.9) {
        // prekážka na dráhe (od zeme po výšku hlavy)
        goal.x = rng.range(-0.8, 0.8);
        goal.y = rng.range(0, 1.9);
        goal.z = rng.range(-7, -1);
      } else {
        // krátky pohľad okolo (do ±35° do strán, ±15° hore/dole)
        const az = (rng.range(-35, 35) * Math.PI) / 180;
        const el = (rng.range(-15, 15) * Math.PI) / 180;
        goal.x = pos.x + Math.sin(az) * 3;
        goal.y = pos.y + Math.tan(el) * 3;
        goal.z = -Math.cos(az) * 3;
      }
      nextSwitch = t + rng.range(0.25, 1.5);
    }
    if (t >= nextMove) {
      dodgeX = rng.next() < 0.5 ? 0 : rng.range(-0.4, 0.4);
      duck = rng.next() < 0.3 ? rng.range(0.15, 0.35) : 0;
      nextMove = t + rng.range(0.6, 2.0);
    }
    // Hlava sa k cieľom približuje plynulo (otočenie hlavy, nie skok).
    target.x += (goal.x - target.x) * 0.15;
    target.y += (goal.y - target.y) * 0.15;
    target.z += (goal.z - target.z) * 0.15;
    pos.x += (dodgeX - pos.x) * 0.08;
    pos.y += (1.45 - duck - pos.y) * 0.08;
    // Chvenie hlavy.
    look.x = target.x + (rng.next() - 0.5) * 0.05;
    look.y = target.y + (rng.next() - 0.5) * 0.05;
    look.z = target.z;
    return lookingAt(pos, look, head);
  };
}

describe('tlačidlo Pauza pri bežnom hraní', () => {
  const cases = [
    ['right', 'side'],
    ['left', 'side'],
    ['right', 'top'],
  ] as const;

  it.each(cases)('pauza %s/%s sa za 5 minút hrania sama nespustí', (side, position) => {
    const game = makeGame(side, position);
    run(game, 0.1, standing());
    press(game, 'start');
    run(game, CONFIG.countdown.default + 0.1, standing(0, -40));
    expect(game.state).toBe('PLAYING');

    const head = normalPlay(side === 'left' ? 1 : position === 'top' ? 2 : 3);
    let maxProgress = 0;
    const frames = Math.round((MINUTES * 60) / DT);
    for (let i = 0; i < frames; i++) {
      game.update(DT, head(i * DT));
      if (game.gaze.focusedId === 'pause') maxProgress = Math.max(maxProgress, game.gaze.progress);
      game.events.clear();
      expect(game.state).toBe('PLAYING');
    }
    expect(game.sim.time).toBeGreaterThan(MINUTES * 60 - 1);
    expect(maxProgress).toBe(0);
  });

  it('úmyselný pohľad na Pauzu ju spustí do 1,2 s (+ jeden krok)', () => {
    const game = makeGame('right', 'side');
    run(game, 0.1, standing());
    press(game, 'start');
    run(game, CONFIG.countdown.default + 0.1, standing(0, -40));
    const pause = game.layout.buttons[0]!;
    const head = lookingAt({ x: 0, y: EYE, z: 0 }, { x: pause.cx, y: pause.cy, z: pause.cz });
    let t = 0;
    while (game.state === 'PLAYING' && t < 3) {
      game.update(DT, head);
      t += DT;
    }
    expect(game.state).toBe('PAUSED');
    expect(t).toBeLessThan(CONFIG.gaze.dwellTime + 2 * DT);
  });
});
