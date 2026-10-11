import { CONFIG, type Config } from '../src/config';
import type { GameEvent } from '../src/core/events';
import { Game } from '../src/core/game';
import { MemoryStorage, SETTINGS_KEY } from '../src/core/settings';
import { createHeadSample, type ButtonId, type HeadSample } from '../src/core/types';

const DEG = Math.PI / 180;

/** Kvaternión pre yaw (okolo +Y) a sklon (okolo +X), poradie YXZ ako kamera v three.js. */
export function quatYawPitch(yawDeg: number, pitchDeg: number) {
  const hy = (yawDeg * DEG) / 2;
  const hp = (pitchDeg * DEG) / 2;
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sp = Math.sin(hp);
  const cp = Math.cos(hp);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/** Platná póza hlavy na danom mieste s daným smerom pohľadu. */
export function headAt(
  x: number,
  y: number,
  z: number,
  yawDeg = 0,
  pitchDeg = 0,
  out: HeadSample = createHeadSample(),
): HeadSample {
  const q = quatYawPitch(yawDeg, pitchDeg);
  out.valid = true;
  out.px = x;
  out.py = y;
  out.pz = z;
  out.qx = q.x;
  out.qy = q.y;
  out.qz = q.z;
  out.qw = q.w;
  return out;
}

/** Hlava v bode p, ktorá sa pozerá na bod t. */
export function lookingAt(
  p: { x: number; y: number; z: number },
  t: { x: number; y: number; z: number },
  out: HeadSample = createHeadSample(),
): HeadSample {
  const dx = t.x - p.x;
  const dy = t.y - p.y;
  const dz = t.z - p.z;
  const len = Math.hypot(dx, dy, dz);
  return headAt(p.x, p.y, p.z, Math.atan2(-dx, -dz) / DEG, Math.asin(dy / len) / DEG, out);
}

/** Jednotkový smer pohľadu pre azimut (+ doprava) a eleváciu (+ hore). */
export function dirAt(azDeg: number, elDeg: number) {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

export const EYE = 1.7;

/** Hra s pamäťovým úložiskom. Kalibrovaná hra začína v READY, inak v SETUP. */
export function makeGame(opts: { calibrated?: boolean; seed?: number; config?: Config } = {}) {
  const storage = new MemoryStorage();
  if (opts.calibrated !== false) storage.setItem(SETTINGS_KEY, JSON.stringify({ eyeHeight: EYE }));
  const game = new Game({ storage, seed: opts.seed ?? 7, config: opts.config ?? CONFIG });
  return { game, storage };
}

export type HeadInput = HeadSample | ((t: number) => HeadSample);

/** Spustí snímky dĺžky dt počas `seconds` a vráti kópie udalostí. */
export function run(game: Game, seconds: number, head: HeadInput, dt = 1 / 90): GameEvent[] {
  const events: GameEvent[] = [];
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    game.update(dt, typeof head === 'function' ? head(i * dt) : head);
    game.events.drain((e) => events.push({ ...e }));
  }
  return events;
}

/** Hlava stojaca v počiatku herného priestoru (pri prvom snímku sa tam vycentruje plocha). */
export function standing(yawDeg = 0, pitchDeg = 0): HeadSample {
  return headAt(0, EYE, 0, yawDeg, pitchDeg);
}

/** Pozerá sa na tlačidlo (z danej polohy hlavy vo svete), kým sa neaktivuje. */
export function press(game: Game, id: ButtonId, from = { x: 0, y: EYE, z: 0 }, dt = 1 / 90): GameEvent[] {
  const events: GameEvent[] = [];
  const head = createHeadSample();
  // Najprv sa pozrie inam (na zem): tlačidlo pod pohľadom sa po aktivácii plní až po odchode pohľadu.
  game.update(dt, headAt(from.x, from.y, from.z, 0, -80, head));
  game.events.drain((e) => events.push({ ...e }));
  for (let i = 0; i < Math.round(5 / dt); i++) {
    const b = game.layout.buttons.find((x) => x.id === id);
    if (!b) throw new Error(`Tlačidlo ${id} nie je aktívne (layout ${game.layout.id})`);
    const target = game.playFrame.toWorldPoint({ x: 0, y: 0, z: 0 }, b.cx, b.cy, b.cz);
    game.update(dt, lookingAt(from, target, head));
    let done = false;
    game.events.drain((e) => {
      events.push({ ...e });
      if (e.type === 'activate' && e.id === id) done = true;
    });
    if (done) return events;
  }
  throw new Error(`Tlačidlo ${id} sa neaktivovalo do 5 s`);
}

/** Od kalibrovanej hry po stav PLAYING. */
export function startPlaying(game: Game): void {
  run(game, 0.1, standing());
  press(game, 'start');
  run(game, game.settings.countdown + 0.1, standing(0, -45));
  if (game.state !== 'PLAYING') throw new Error(`Očakávaný PLAYING, je ${game.state}`);
}
