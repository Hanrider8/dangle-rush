/**
 * Rozloženie panelov a tlačidiel v hernom priestore (world-locked voči vycentrovanej ploche).
 *
 * Panely sú ploché, otočené k nominálnej pozícii hlavy (0, výška očí, 0). Pozície prvkov sa zadávajú
 * v stupňoch od kotvy panelu, takže rozostupy z pohľadu hráča nezávisia od vzdialenosti panelu.
 *
 * - Predná kotva (v smere hry): SETUP, READY, GAME_OVER a ich nastavenia.
 * - Kotva pauzy (bok ±60° vo výške očí alebo hore 35°): tlačidlo Pauza, panel PAUSED
 *   (Pokračovať presne na mieste Pauzy) a nastavenia otvorené z pauzy.
 */
import type { Config } from '../config';
import type { GazeButton } from './gaze';
import { DEG } from './math';
import type { PausePosition, PauseSide } from './settings';
import type { ButtonId, Rect3, TextId } from './types';

export type LayoutId =
  | 'none'
  | 'setup'
  | 'ready'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'gameOver'
  | 'settings'
  | 'recenter';

/** Rovina panelu: stred, osi a vzdialenosť od nominálnej hlavy. */
export interface Anchor extends Rect3 {
  distance: number;
}

export interface TextBlock extends Rect3 {
  readonly id: TextId;
}

export interface PanelLayout {
  readonly id: LayoutId;
  /** Aktívne tlačidlá (ovládané pohľadom). */
  readonly buttons: GazeButton[];
  /** Viditeľné, ale neaktívne tlačidlá (napr. Pauza počas odpočtu). */
  readonly inactive: GazeButton[];
  readonly texts: TextBlock[];
}

export interface LayoutContext {
  /** Kalibrovaná (alebo predvolená) výška očí. */
  eyeHeight: number;
  /** Výška kalibračného tlačidla: výška hlavy pri vstupe do SETUP. */
  setupHeight: number;
  pauseSide: PauseSide;
  pausePosition: PausePosition;
}

export type SettingsAnchor = 'front' | 'pause';

/** Kotva v smere azimutu (+ doprava) a elevácie (+ hore) od nominálnej hlavy (0, eyeHeight, 0). */
export function anchorAt(eyeHeight: number, azDeg: number, elDeg: number, distance: number): Anchor {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  const dx = Math.sin(az) * Math.cos(el);
  const dy = Math.sin(el);
  const dz = -Math.cos(az) * Math.cos(el);
  const nx = -dx;
  const ny = -dy;
  const nz = -dz;
  // u = normalize(up × n): vodorovná os doprava z pohľadu hráča; v = n × u.
  const ul = Math.hypot(nz, nx);
  const ux = nz / ul;
  const uz = -nx / ul;
  return {
    cx: dx * distance,
    cy: eyeHeight + dy * distance,
    cz: dz * distance,
    ux,
    uy: 0,
    uz,
    vx: ny * uz,
    vy: nz * ux - nx * uz,
    vz: -ny * ux,
    nx,
    ny,
    nz,
    halfW: 0,
    halfH: 0,
    distance,
  };
}

/** Obdĺžnik na rovine kotvy posunutý o uhly (dAz, dEl) s uhlovou veľkosťou w × h. */
function rectOn(a: Anchor, dAzDeg: number, dElDeg: number, wDeg: number, hDeg: number): Rect3 {
  const ox = a.distance * Math.tan(dAzDeg * DEG);
  const oy = a.distance * Math.tan(dElDeg * DEG);
  return {
    cx: a.cx + ox * a.ux + oy * a.vx,
    cy: a.cy + ox * a.uy + oy * a.vy,
    cz: a.cz + ox * a.uz + oy * a.vz,
    ux: a.ux,
    uy: a.uy,
    uz: a.uz,
    vx: a.vx,
    vy: a.vy,
    vz: a.vz,
    nx: a.nx,
    ny: a.ny,
    nz: a.nz,
    halfW: a.distance * Math.tan((wDeg / 2) * DEG),
    halfH: a.distance * Math.tan((hDeg / 2) * DEG),
  };
}

function button(
  id: ButtonId,
  a: Anchor,
  dAz: number,
  dEl: number,
  size: { w: number; h: number },
  requireEntry = false,
): GazeButton {
  return { ...rectOn(a, dAz, dEl, size.w, size.h), id, requireEntry, armed: !requireEntry };
}

function text(id: TextId, a: Anchor, dAz: number, dEl: number, wDeg: number, hDeg: number): TextBlock {
  return { ...rectOn(a, dAz, dEl, wDeg, hDeg), id };
}

export function frontAnchor(ctx: LayoutContext, cfg: Config, height = ctx.eyeHeight): Anchor {
  return anchorAt(height, 0, 0, cfg.ui.frontDistance);
}

/** Kotva tlačidla Pauza; počíta sa voči vycentrovanej ploche, nie voči hlave. */
export function pauseAnchor(ctx: LayoutContext, cfg: Config): Anchor {
  const pb = cfg.pauseButton;
  if (ctx.pausePosition === 'top') return anchorAt(ctx.eyeHeight, 0, pb.topElevationDeg, pb.distance);
  const az = ctx.pauseSide === 'left' ? -pb.sideAzimuthDeg : pb.sideAzimuthDeg;
  return anchorAt(ctx.eyeHeight, az, 0, pb.distance);
}

/** Panel nastavení: pri polohe pauzy „hore“ sa zníži, aby sa nemuselo pozerať príliš nahor. */
function settingsAnchor(kind: SettingsAnchor, ctx: LayoutContext, cfg: Config): Anchor {
  if (kind === 'front') return frontAnchor(ctx, cfg);
  if (ctx.pausePosition === 'top') {
    const el = Math.min(cfg.pauseButton.topElevationDeg, cfg.ui.maxPanelElevationDeg);
    return anchorAt(ctx.eyeHeight, 0, el, cfg.pauseButton.distance);
  }
  return pauseAnchor(ctx, cfg);
}

export function computeLayout(
  id: LayoutId,
  ctx: LayoutContext,
  cfg: Config,
  settingsAt: SettingsAnchor = 'front',
): PanelLayout {
  const B = cfg.ui.buttonDeg;
  const S = cfg.ui.settingsButtonDeg;
  const gap = cfg.ui.minButtonGapDeg;
  const step = B.w + gap; // vodorovný rozostup bežných tlačidiel
  const rowDrop = -(B.h + gap); // rad pod hlavným tlačidlom panelu pauzy
  const layout: PanelLayout = { id, buttons: [], inactive: [], texts: [] };
  const { buttons, inactive, texts } = layout;

  switch (id) {
    case 'setup': {
      const a = frontAnchor(ctx, cfg, ctx.setupHeight);
      buttons.push(button('calibrate', a, 0, 0, { w: 14, h: 5 }));
      texts.push(text('setupInfo', a, 0, 8, 38, 8));
      break;
    }
    case 'ready': {
      const a = frontAnchor(ctx, cfg);
      const row = cfg.ui.frontRowElevationDeg;
      texts.push(text('readyInfo', a, 0, 2.5, 38, 10));
      buttons.push(button('recenter', a, -step, row, B));
      buttons.push(button('start', a, 0, row, B));
      buttons.push(button('settings', a, step, row, B));
      break;
    }
    case 'countdown': {
      // Mierne pod úrovňou očí, aby sa neprekrýval s HUD nad koncom dráhy.
      const a = anchorAt(ctx.eyeHeight, 0, -2, cfg.ui.countdownDistance);
      texts.push(text('countdown', a, 0, 0, 12, 9));
      inactive.push(button('pause', pauseAnchor(ctx, cfg), 0, 0, B));
      break;
    }
    case 'playing': {
      buttons.push(button('pause', pauseAnchor(ctx, cfg), 0, 0, B, true));
      break;
    }
    case 'paused': {
      const a = pauseAnchor(ctx, cfg);
      texts.push(text('pausedTitle', a, 0, B.h / 2 + 3, 24, 4));
      buttons.push(button('resume', a, 0, 0, B));
      buttons.push(button('newGame', a, -step, rowDrop, B));
      buttons.push(button('recenter', a, 0, rowDrop, B));
      buttons.push(button('settings', a, step, rowDrop, B));
      break;
    }
    case 'gameOver': {
      const a = frontAnchor(ctx, cfg);
      const row = cfg.ui.frontRowElevationDeg;
      texts.push(text('results', a, 0, 4.5, 38, 15));
      buttons.push(button('newGame', a, -step / 2, row, B));
      buttons.push(button('settings', a, step / 2, row, B));
      break;
    }
    case 'settings': {
      const a = settingsAnchor(settingsAt, ctx, cfg);
      const col = S.w + gap;
      const rowH = S.h + gap;
      texts.push(text('settingsTitle', a, 0, rowH + S.h / 2 + 3, 30, 4));
      const grid: ButtonId[][] = [
        ['set.dwell', 'set.difficulty', 'set.floor'],
        ['set.pausePos', 'set.pauseSide', 'set.countdown'],
        ['set.calibrate', 'set.back', 'set.debug'],
      ];
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r]!.length; c++) {
          buttons.push(button(grid[r]![c]!, a, (c - 1) * col, (1 - r) * rowH, S));
        }
      }
      break;
    }
    case 'recenter':
    case 'none':
      break;
  }
  return layout;
}
