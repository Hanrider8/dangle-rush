import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { Game } from '../src/core/game';
import { makeSideBlock } from '../src/core/obstacles';
import { headAt, makeGame, press, run, standing, startPlaying } from './helpers';

const DT = CONFIG.sim.fixedDt;

/** Hráč v postoji: hlava nízko, pozerá na loptičku. Pod vysokou tyčou prejde. */
const crouched = () => headAt(0, 1.2, 0, 0, -50);

function playUntil(game: Game, time: number) {
  for (let i = 0; i < 100000 && game.sim.time < time - 1e-9; i++) game.update(DT, crouched());
  game.events.clear();
}

describe('pauza', () => {
  it('zmrazí prekážky, čas, spawn aj obtiažnosť', () => {
    const { game } = makeGame();
    startPlaying(game);
    playUntil(game, 6);
    expect(game.sim.obstacles.some((o) => o.active)).toBe(true);
    game.autoPause('visibility');
    const frozen = game.sim.snapshot();
    // 10 s pauzy, hráč sa medzitým hýbe a pozerá kade-tade.
    run(game, 10, (t) => headAt(Math.sin(t) * 0.5, 1.5, Math.cos(t) * 0.3, t * 40, -20));
    expect(game.state).toBe('PAUSED');
    expect(game.sim.snapshot()).toEqual(frozen);
    // Pokračovať → odpočet: stále zmrazené.
    press(game, 'resume');
    run(game, CONFIG.countdown.default - 0.1, crouched());
    expect(game.state).toBe('COUNTDOWN');
    expect(game.sim.snapshot()).toEqual(frozen);
  });

  it('pokračovanie ide presne odtiaľ, kde hra stála (rovnaký priebeh ako bez pauzy)', () => {
    const a = makeGame({ seed: 42 }).game;
    startPlaying(a);
    playUntil(a, 14);

    const b = makeGame({ seed: 42 }).game;
    startPlaying(b);
    playUntil(b, 5);
    b.autoPause('visibility');
    run(b, 8, standing(70, 0));
    press(b, 'resume');
    run(b, CONFIG.countdown.default + 0.05, crouched());
    expect(b.state).toBe('PLAYING');
    playUntil(b, 14);

    expect(b.sim.snapshot()).toEqual(a.sim.snapshot());
  });

  it('presun hlavy počas pauzy sa po pokračovaní nevyhodnotí ako zásah', () => {
    const { game } = makeGame();
    startPlaying(game);
    run(game, 0.2, headAt(0.5, 1.4, 0)); // hráč stojí vpravo, až potom príde blok
    for (const o of game.sim.obstacles) o.active = false;
    // Bočný blok vľavo tesne pred hráčom, hráč stojí vpravo od neho.
    const o = game.sim.obstacles[0]!;
    makeSideBlock(o, -1, game.eyeHeight, CONFIG);
    o.active = true;
    o.resolved = false;
    o.z = o.prevZ = -0.05;
    game.sim.spawnPause = 100;
    run(game, 0.05, headAt(0.5, 1.4, 0));
    expect(game.sim.lives).toBe(CONFIG.rules.lives);
    game.autoPause('tracking');
    const z = o.z;
    // Počas pauzy hráč prejde na ľavú stranu bloku (cez miesto, kde blok stojí).
    run(game, 1, (t) => headAt(0.5 - 2 * t, 1.4, 0));
    press(game, 'resume', { x: -1.5, y: 1.4, z: 0 });
    run(game, CONFIG.countdown.default + 0.2, headAt(-1.5, 1.4, 0));
    expect(game.state).toBe('PLAYING');
    expect(o.z).toBeGreaterThan(z);
    expect(game.sim.lives).toBe(CONFIG.rules.lives);
  });
});
