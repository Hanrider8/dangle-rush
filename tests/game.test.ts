import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { computeLayout } from '../src/core/layout';
import { loadSettings } from '../src/core/settings';
import { EYE, headAt, lookingAt, makeGame, press, run, standing, startPlaying } from './helpers';

describe('stavový automat', () => {
  it('bez kalibrácie začne v SETUP a po dwell uloží výšku hlavy a prejde do READY', () => {
    const { game, storage } = makeGame({ calibrated: false });
    expect(game.state).toBe('SETUP');
    run(game, 0.1, standing());
    expect(game.layout.id).toBe('setup');
    const events = press(game, 'calibrate');
    expect(game.state).toBe('READY');
    expect(events.some((e) => e.type === 'calibrated')).toBe(true);
    expect(game.settings.eyeHeight).toBeCloseTo(EYE, 3);
    expect(loadSettings(storage, CONFIG).eyeHeight).toBeCloseTo(EYE, 3);
  });

  it('kalibračné tlačidlo je vo výške hlavy priamo pred hráčom', () => {
    const { game } = makeGame({ calibrated: false });
    run(game, 0.1, standing());
    const b = game.layout.buttons[0]!;
    expect(b.id).toBe('calibrate');
    expect(b.cy).toBeCloseTo(EYE, 6);
    expect(b.cx).toBeCloseTo(0, 6);
    expect(b.cz).toBeCloseTo(-CONFIG.ui.frontDistance, 6);
  });

  it('nezmyselnú výšku hlavy kalibrácia neprijme', () => {
    const { game } = makeGame({ calibrated: false });
    run(game, 0.1, standing());
    press(game, 'calibrate', { x: 0, y: 0.6, z: 0 }); // hlava pri zemi
    expect(game.state).toBe('SETUP');
    expect(game.calibrationError).toBe(true);
    expect(game.settings.eyeHeight).toBeNull();
  });

  it('s uloženou výškou SETUP preskočí', () => {
    const { game } = makeGame();
    expect(game.state).toBe('READY');
    run(game, 0.1, standing());
    expect(game.layout.id).toBe('ready');
    expect(game.layout.buttons.map((b) => b.id)).toEqual(['recenter', 'start', 'settings']);
  });

  it('pred prvou platnou pózou neukazuje žiadne tlačidlá', () => {
    const { game } = makeGame();
    run(game, 0.5, { ...standing(), valid: false });
    expect(game.centered).toBe(false);
    expect(game.layout.id).toBe('none');
  });

  it('READY → Štart → COUNTDOWN (s pípaním) → PLAYING', () => {
    const { game } = makeGame();
    run(game, 0.1, standing());
    const events = press(game, 'start');
    expect(game.state).toBe('COUNTDOWN');
    expect(events.filter((e) => e.type === 'countdownBeep').map((e) => e.n)).toEqual([2]);
    const more = run(game, 1.5, standing());
    expect(game.state).toBe('COUNTDOWN');
    expect(more.filter((e) => e.type === 'countdownBeep').map((e) => e.n)).toEqual([1]);
    const last = run(game, 0.6, standing());
    expect(game.state).toBe('PLAYING');
    expect(last.some((e) => e.type === 'go')).toBe(true);
  });

  it('PLAYING → Pauza → PAUSED → Pokračovať → COUNTDOWN → PLAYING', () => {
    const { game } = makeGame();
    startPlaying(game);
    run(game, 0.3, standing(0, -45));
    press(game, 'pause');
    expect(game.state).toBe('PAUSED');
    expect(game.pauseCause).toBe('button');
    expect(game.layout.buttons.map((b) => b.id)).toEqual(['resume', 'newGame', 'recenter', 'settings']);
    press(game, 'resume');
    expect(game.state).toBe('COUNTDOWN');
    run(game, 2.1, standing(0, -45));
    expect(game.state).toBe('PLAYING');
  });

  it('automatická pauza z PLAYING aj COUNTDOWN, v ostatných stavoch nič', () => {
    const { game } = makeGame();
    run(game, 0.1, standing());
    game.autoPause('visibility');
    expect(game.state).toBe('READY');
    press(game, 'start');
    game.autoPause('tracking');
    expect(game.state).toBe('PAUSED');
    expect(game.pauseCause).toBe('tracking');
    press(game, 'resume');
    run(game, 2.1, standing(0, -45));
    game.autoPause('visibility');
    expect(game.state).toBe('PAUSED');
    expect(game.pauseCause).toBe('visibility');
  });

  it('strata posledného života → GAME_OVER s výsledkami a rekordom', () => {
    const { game } = makeGame();
    startPlaying(game);
    // Hráč stojí vzpriamene uprostred: obrancovia ho postupne zasiahnu.
    playUntilGameOver(game);
    expect(game.state).toBe('GAME_OVER');
    expect(game.sim.lives).toBe(0);
    expect(game.result).not.toBeNull();
    expect(game.result!.hits).toBe(CONFIG.rules.lives);
    expect(game.result!.best).toBe(game.result!.score);
    expect(game.layout.buttons.map((b) => b.id)).toEqual(['newGame', 'settings']);
  });

  it('GAME_OVER → Nová hra → COUNTDOWN s čistou hrou', () => {
    const { game } = makeGame();
    startPlaying(game);
    playUntilGameOver(game);
    expect(game.state).toBe('GAME_OVER');
    press(game, 'newGame');
    expect(game.state).toBe('COUNTDOWN');
    expect(game.sim.lives).toBe(CONFIG.rules.lives);
    expect(game.sim.time).toBe(0);
    expect(game.sim.obstacles.some((o) => o.active)).toBe(false);
  });

  it('nastavenia: zmena dwell sa uloží a hneď platí, Späť vráti hlavný panel', () => {
    const { game, storage } = makeGame();
    run(game, 0.1, standing());
    press(game, 'settings');
    expect(game.sub).toBe('settings');
    expect(game.layout.id).toBe('settings');
    press(game, 'set.dwell');
    expect(game.settings.dwellTime).toBeCloseTo(1.4, 9);
    expect(game.gaze.dwellTime).toBeCloseTo(1.4, 9);
    expect(loadSettings(storage, CONFIG).dwellTime).toBeCloseTo(1.4, 9);
    press(game, 'set.back');
    expect(game.sub).toBe('main');
    expect(game.layout.id).toBe('ready');
  });

  it('nastavenia z pauzy sú pri kotve pauzy a zmena strany ich nepresunie', () => {
    const { game } = makeGame();
    startPlaying(game);
    press(game, 'pause');
    press(game, 'settings');
    const before = game.layout.buttons.find((b) => b.id === 'set.pauseSide')!;
    expect(before.cx).toBeGreaterThan(0); // vpravo
    press(game, 'set.pauseSide');
    expect(game.settings.pauseSide).toBe('left');
    const after = game.layout.buttons.find((b) => b.id === 'set.pauseSide')!;
    expect(after.cx).toBe(before.cx);
    press(game, 'set.back');
    expect(game.layout.buttons.find((b) => b.id === 'resume')!.cx).toBeLessThan(0); // teraz vľavo
  });

  it('Vycentrovať počká 3 s, kým sa hráč otočí, a potom vezme jeho pózu', () => {
    const { game } = makeGame();
    run(game, 0.1, standing());
    press(game, 'recenter');
    expect(game.sub).toBe('recenter');
    expect(game.layout.buttons).toEqual([]);
    const turned = headAt(1, EYE, 2, 90, -20); // otočený na −X, posunutý
    const events = run(game, 2.9, turned);
    expect(game.sub).toBe('recenter');
    expect(events.filter((e) => e.type === 'recenterBeep').map((e) => e.n)).toEqual([2, 1]);
    run(game, 0.2, turned);
    expect(game.sub).toBe('main');
    expect(game.playFrame.originX).toBeCloseTo(1, 6);
    expect(game.playFrame.originZ).toBeCloseTo(2, 6);
    expect((game.playFrame.yaw * 180) / Math.PI).toBeCloseTo(90, 6);
  });

  it('po vycentrovaní sa Štart nespustí, aj keď naň hráč práve pozerá', () => {
    const { game } = makeGame();
    run(game, 0.1, standing());
    press(game, 'recenter');
    // Hráč sa otočí smerom hry a pozerá mierne nadol: presne tam bude po vycentrovaní Štart.
    const start = game.layout.id === 'recenter' ? computeStart() : null;
    expect(start).not.toBeNull();
    run(game, 8, headAt(0, EYE, 0, 0, start!.el));
    expect(game.state).toBe('READY');
    expect(game.sub).toBe('main');
    // Po odvrátení a návrate pohľadu sa Štart spustí normálne.
    press(game, 'start');
    expect(game.state).toBe('COUNTDOWN');
  });

  it('nová kalibrácia z pauzy sa vráti do pauzy a hru nestratí', () => {
    const { game } = makeGame();
    startPlaying(game);
    run(game, 3, standing(0, -45));
    press(game, 'pause');
    const time = game.sim.time;
    press(game, 'settings');
    press(game, 'set.calibrate');
    expect(game.state).toBe('SETUP');
    press(game, 'calibrate', { x: 0, y: 1.82, z: 0 });
    expect(game.state).toBe('PAUSED');
    expect(game.settings.eyeHeight).toBeCloseTo(1.82, 3);
    expect(game.sim.time).toBe(time);
  });

  it('pri novej session sa plocha vycentruje podľa prvej platnej pózy', () => {
    const { game } = makeGame();
    run(game, 0.1, standing());
    game.beginSession();
    run(game, 0.1, headAt(3, EYE, -1, -45, 0));
    expect(game.playFrame.originX).toBeCloseTo(3, 6);
    expect((game.playFrame.yaw * 180) / Math.PI).toBeCloseTo(-45, 6);
    // Tlačidlá sú stále pred hráčom v smere jeho pohľadu.
    const start = game.layout.buttons.find((b) => b.id === 'start')!;
    const w = game.playFrame.toWorldPoint({ x: 0, y: 0, z: 0 }, start.cx, start.cy, start.cz);
    const look = lookingAt({ x: 3, y: EYE, z: -1 }, w);
    expect(look.valid).toBe(true);
    expect(w.x).toBeGreaterThan(3); // yaw −45° = pohľad doprava-dopredu
  });
});

/** Elevácia tlačidla Štart na paneli READY z pohľadu nominálnej hlavy. */
function computeStart() {
  const layout = computeLayout('ready', { eyeHeight: EYE, setupHeight: EYE, pauseSide: 'right', pausePosition: 'side' }, CONFIG);
  const b = layout.buttons.find((x) => x.id === 'start')!;
  return { el: (Math.atan2(b.cy - EYE, -b.cz) * 180) / Math.PI };
}

/** Hráč stojí vzpriamene v strede, kým ho obrancovia nezasiahnu trikrát (najviac 10 minút). */
function playUntilGameOver(game: import('../src/core/game').Game) {
  for (let t = 0; t < 600 && game.state === 'PLAYING'; t++) run(game, 1, standing(0, -45));
}
