import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { hitsRect } from '../src/core/gaze';
import { computeLayout, type LayoutContext, type LayoutId, type SettingsAnchor } from '../src/core/layout';
import type { Rect3, Vec3 } from '../src/core/types';
import { EYE, makeGame, press, run, standing } from './helpers';

const DEG = Math.PI / 180;

function ctx(over: Partial<LayoutContext> = {}): LayoutContext {
  return { eyeHeight: EYE, setupHeight: EYE, pauseSide: 'right', pausePosition: 'side', ...over };
}

/** Azimut a elevácia stredu obdĺžnika z pohľadu nominálnej hlavy. */
function direction(r: Rect3, head: Vec3 = { x: 0, y: EYE, z: 0 }) {
  const dx = r.cx - head.x;
  const dy = r.cy - head.y;
  const dz = r.cz - head.z;
  return {
    az: Math.atan2(dx, -dz) / DEG,
    el: Math.atan2(dy, Math.hypot(dx, dz)) / DEG,
  };
}

/** Body na obvode obdĺžnika. */
function border(r: Rect3, n = 48): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 4;
    const side = Math.floor(t);
    const f = t - side;
    const lx = side === 0 ? -1 + 2 * f : side === 1 ? 1 : side === 2 ? 1 - 2 * f : -1;
    const ly = side === 0 ? -1 : side === 1 ? -1 + 2 * f : side === 2 ? 1 : 1 - 2 * f;
    pts.push({
      x: r.cx + lx * r.halfW * r.ux + ly * r.halfH * r.vx,
      y: r.cy + lx * r.halfW * r.uy + ly * r.halfH * r.vy,
      z: r.cz + lx * r.halfW * r.uz + ly * r.halfH * r.vz,
    });
  }
  return pts;
}

describe('tlačidlo Pauza', () => {
  it('je bokom vo výške očí 60° od smeru hry (vpravo aj vľavo)', () => {
    for (const side of ['right', 'left'] as const) {
      const pause = computeLayout('playing', ctx({ pauseSide: side }), CONFIG).buttons[0]!;
      const d = direction(pause);
      expect(d.az).toBeCloseTo(side === 'right' ? 60 : -60, 6);
      expect(d.el).toBeCloseTo(0, 6);
      expect(Math.hypot(pause.cx, pause.cy - EYE, pause.cz)).toBeCloseTo(CONFIG.pauseButton.distance, 6);
    }
  });

  it('v polohe „hore“ je 35° nad horizontom v smere hry', () => {
    const pause = computeLayout('playing', ctx({ pausePosition: 'top' }), CONFIG).buttons[0]!;
    const d = direction(pause);
    expect(d.az).toBeCloseTo(0, 6);
    expect(d.el).toBeCloseTo(35, 6);
  });

  it('je otočené k hráčovi a vyžaduje vstup pohľadom', () => {
    const pause = computeLayout('playing', ctx(), CONFIG).buttons[0]!;
    const toHead = { x: -pause.cx, y: EYE - pause.cy, z: -pause.cz };
    const len = Math.hypot(toHead.x, toHead.y, toHead.z);
    expect(pause.nx).toBeCloseTo(toHead.x / len, 6);
    expect(pause.nz).toBeCloseTo(toHead.z / len, 6);
    expect(pause.requireEntry).toBe(true);
  });

  it('pozícia sa počíta voči ploche, nie voči hlave', () => {
    const { game } = makeGame();
    run(game, 0.1, standing());
    press(game, 'start');
    run(game, 2.2, standing());
    expect(game.state).toBe('PLAYING');
    const before = { ...game.layout.buttons[0]! };
    run(game, 0.5, standing(-40, -60)); // hráč sa otočí a pozerá na loptičku
    expect(game.layout.buttons[0]).toMatchObject({ cx: before.cx, cy: before.cy, cz: before.cz });
  });

  it('panel pauzy má Pokračovať presne na mieste tlačidla Pauza', () => {
    for (const c of [ctx(), ctx({ pauseSide: 'left' }), ctx({ pausePosition: 'top' })]) {
      const pause = computeLayout('playing', c, CONFIG).buttons[0]!;
      const resume = computeLayout('paused', c, CONFIG).buttons.find((b) => b.id === 'resume')!;
      expect(resume.cx).toBeCloseTo(pause.cx, 9);
      expect(resume.cy).toBeCloseTo(pause.cy, 9);
      expect(resume.cz).toBeCloseTo(pause.cz, 9);
    }
  });
});

describe('rozostupy tlačidiel', () => {
  it('medzera v configu má rezervu nad dvojnásobkom hysterézy', () => {
    expect(CONFIG.ui.minButtonGapDeg).toBeGreaterThan(2 * CONFIG.gaze.hysteresisDeg);
  });

  const cases: [LayoutId, LayoutContext, SettingsAnchor][] = [];
  for (const c of [ctx(), ctx({ pauseSide: 'left' }), ctx({ pausePosition: 'top' })]) {
    for (const id of ['setup', 'ready', 'paused', 'gameOver', 'settings', 'playing'] as LayoutId[]) {
      cases.push([id, c, 'front'], [id, c, 'pause']);
    }
  }

  it.each(cases)('%s: medzi susednými tlačidlami je aspoň 2 × hysteréza', (id, c, at) => {
    const layout = computeLayout(id, c, CONFIG, at);
    const head = { x: 0, y: EYE, z: 0 };
    // Pohľad kamkoľvek na tlačidlo B je ďaleko od A aj s dvojnásobnou hysterézou.
    const margin = Math.tan(2 * CONFIG.gaze.hysteresisDeg * DEG);
    for (const a of layout.buttons) {
      for (const b of layout.buttons) {
        if (a === b) continue;
        for (const p of border(b)) {
          const len = Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z);
          const dir = { x: (p.x - head.x) / len, y: (p.y - head.y) / len, z: (p.z - head.z) / len };
          expect(hitsRect(a, head, dir, margin), `${a.id} vs ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('po kalibrácii pohľad vpred vo výške očí nepadne na Štart', () => {
    const layout = computeLayout('ready', ctx(), CONFIG);
    const start = layout.buttons.find((b) => b.id === 'start')!;
    const margin = Math.tan(CONFIG.gaze.hysteresisDeg * DEG);
    expect(hitsRect(start, { x: 0, y: EYE, z: 0 }, { x: 0, y: 0, z: -1 }, margin)).toBe(false);
  });

  it('panel nastavení pri polohe pauzy „hore“ je znížený', () => {
    const layout = computeLayout('settings', ctx({ pausePosition: 'top' }), CONFIG, 'pause');
    const center = layout.buttons.find((b) => b.id === 'set.pauseSide')!;
    expect(direction(center).el).toBeCloseTo(CONFIG.ui.maxPanelElevationDeg, 6);
  });
});
