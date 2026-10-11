import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EventQueue } from '../src/core/events';
import { GazeSystem, type GazeButton } from '../src/core/gaze';
import type { ButtonId, Vec3 } from '../src/core/types';
import { dirAt } from './helpers';

const DT = 1 / 120;
const HEAD: Vec3 = { x: 0, y: 1.6, z: 0 };
const DIST = 2;
const HALF_W = 0.2;
/** Uhol hrany tlačidla od jeho stredu (pri vzdialenosti 2 m). */
const EDGE_DEG = (Math.atan(HALF_W / DIST) * 180) / Math.PI;

function makeButton(id: ButtonId, azDeg = 0, requireEntry = false): GazeButton {
  const d = dirAt(azDeg, 0);
  return {
    id,
    cx: HEAD.x + d.x * DIST,
    cy: HEAD.y,
    cz: HEAD.z + d.z * DIST,
    ux: -d.z,
    uy: 0,
    uz: d.x,
    vx: 0,
    vy: 1,
    vz: 0,
    nx: -d.x,
    ny: 0,
    nz: -d.z,
    halfW: HALF_W,
    halfH: 0.08,
    requireEntry,
    armed: !requireEntry,
  };
}

function setup(buttons: GazeButton[] = [makeButton('start')]) {
  const events = new EventQueue();
  const gaze = new GazeSystem(CONFIG.gaze, events);
  gaze.setButtons(buttons);
  const activations: string[] = [];
  /** Pozerá sa daným smerom `seconds` sekúnd. */
  const look = (azDeg: number, seconds: number, elDeg = 0, valid = true) => {
    const fwd = dirAt(azDeg, elDeg);
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const id = gaze.step(DT, HEAD, fwd, valid);
      if (id) activations.push(id);
    }
  };
  return { gaze, events, activations, look };
}

describe('dwell', () => {
  it('aktivuje tlačidlo po 1,2 s pohľadu, nie skôr', () => {
    const { activations, look, gaze } = setup();
    look(0, 1.1);
    expect(activations).toEqual([]);
    expect(gaze.progress).toBeGreaterThan(0.9);
    look(0, 0.1);
    expect(activations).toEqual(['start']);
  });

  it('čas dwell sa dá zmeniť (0,8 s a 2,0 s)', () => {
    for (const dwell of [0.8, 2.0]) {
      const { activations, look, gaze } = setup();
      gaze.dwellTime = dwell;
      look(0, dwell - 0.05);
      expect(activations).toEqual([]);
      look(0, 0.06);
      expect(activations).toEqual(['start']);
    }
  });

  it('hlási tiky počas plnenia a potvrdenie pri aktivácii', () => {
    const { events, look } = setup();
    look(0, 1.2);
    const types: string[] = [];
    events.drain((e) => types.push(e.type));
    expect(types[0]).toBe('dwellStart');
    expect(types.filter((t) => t === 'dwellTick').length).toBe(5);
    expect(types.at(-1)).toBe('activate');
  });
});

describe('hysteréza', () => {
  it('plnenie začne, len keď lúč trafí tlačidlo', () => {
    const { gaze, look } = setup();
    look(EDGE_DEG + 1, 0.5);
    expect(gaze.focused).toBeNull();
    look(EDGE_DEG - 1, 0.1);
    expect(gaze.focusedId).toBe('start');
  });

  it('na hrane +2° plnenie pokračuje, na hrane +4° sa preruší', () => {
    const { gaze, look, activations } = setup();
    look(0, 0.3);
    look(EDGE_DEG + 2, 0.5);
    expect(gaze.focusedId).toBe('start');
    expect(gaze.progress).toBeGreaterThan(0.6);
    look(EDGE_DEG + 4, 0.3);
    expect(gaze.focused).toBeNull();
    expect(gaze.progress).toBe(0);
    expect(activations).toEqual([]);
  });

  it('výpadok 140 ms plnenie nepreruší, výpadok 160 ms áno', () => {
    const a = setup();
    a.look(0, 0.5);
    const held = a.gaze.progress;
    a.look(30, 0.14);
    expect(a.gaze.focusedId).toBe('start');
    expect(a.gaze.progress).toBeCloseTo(held, 9); // počas výpadku sa progres len drží
    a.look(0, 0.75);
    expect(a.activations).toEqual(['start']);

    const b = setup();
    b.look(0, 0.5);
    b.look(30, 0.16);
    expect(b.gaze.focused).toBeNull();
    expect(b.gaze.progress).toBe(0);
  });

  it('neplatná póza hlavy plnenie zruší', () => {
    const { gaze, look } = setup();
    look(0, 0.5);
    look(0, DT, 0, false);
    expect(gaze.focused).toBeNull();
    expect(gaze.cursorVisible).toBe(false);
  });
});

describe('cooldown', () => {
  it('po aktivácii sa tlačidlo nespustí znova, kým pohľad neodíde', () => {
    const { gaze, look, activations } = setup();
    look(0, 1.2);
    expect(activations).toEqual(['start']);
    look(0, 5);
    expect(gaze.focused).toBeNull();
    expect(activations).toEqual(['start']);
    look(30, 0.1);
    look(0, 1.25);
    expect(activations).toEqual(['start', 'start']);
  });

  it('po aktivácii je tlačidlo aspoň 1 s neaktívne, aj keď pohľad odíde a vráti sa', () => {
    const { gaze, look, activations } = setup();
    look(0, 1.2);
    look(30, 0.1);
    look(0, 0.8);
    expect(gaze.focused).toBeNull();
    look(0, 0.15);
    expect(gaze.focusedId).toBe('start');
    look(0, 1.2);
    expect(activations).toEqual(['start', 'start']);
  });

  it('tlačidlo na novom paneli pod pohľadom sa po aktivácii nespustí samo', () => {
    const { gaze, look, activations } = setup([makeButton('pause')]);
    look(0, 1.2);
    expect(activations).toEqual(['pause']);
    // Panel pauzy: Pokračovať je presne na mieste Pauzy.
    gaze.setButtons([makeButton('resume')]);
    look(0, 5);
    expect(activations).toEqual(['pause']);
    look(25, 0.1);
    look(0, 1.25);
    expect(activations).toEqual(['pause', 'resume']);
  });
});

describe('kurzor', () => {
  it('je viditeľný len do 20° od tlačidla', () => {
    const { gaze, look } = setup();
    look(19, DT);
    expect(gaze.cursorVisible).toBe(true);
    expect(gaze.nearestAngleDeg).toBeCloseTo(19, 6);
    look(21, DT);
    expect(gaze.cursorVisible).toBe(false);
    look(0, DT, -25); // pohľad na loptičku pod tlačidlom
    expect(gaze.cursorVisible).toBe(false);
  });

  it('leží na rovine tlačidla v mieste pohľadu', () => {
    const { gaze, look } = setup();
    look(3, DT);
    expect(gaze.cursor.z).toBeCloseTo(-DIST, 9);
    expect(gaze.cursor.x).toBeCloseTo(Math.tan((3 * Math.PI) / 180) * DIST, 9);
  });
});

describe('tlačidlo vyžadujúce vstup pohľadom (Pauza)', () => {
  it('nespustí sa, ak sa naň hráč pozeral už pri zobrazení', () => {
    const { look, activations, gaze } = setup([]);
    look(0, 0.2);
    gaze.setButtons([makeButton('pause', 0, true)]);
    look(0, 3);
    expect(activations).toEqual([]);
    look(40, 0.2);
    look(0, 1.25);
    expect(activations).toEqual(['pause']);
  });
});
