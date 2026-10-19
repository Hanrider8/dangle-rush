/**
 * UI v priestore: tlačidlá a textové panely podľa aktuálneho rozloženia z core/layout,
 * kurzor pohľadu, HUD a pokyn pri vycentrovaní. Rozloženie sa prenesie len pri zmene layoutVersion.
 */
import { Group, Quaternion, Vector3, type Scene } from 'three';
import type { Config } from '../config';
import type { Game } from '../core/game';
import type { GazeButton } from '../core/gaze';
import type { Settings } from '../core/settings';
import type { ButtonId, HeadSample, Rect3, TextId } from '../core/types';
import { GazeCursor } from '../render/cursor';
import { Button3D } from './buttons';
import { COLORS, CanvasPanel, FONT_FAMILY, fitText, placeOnRect, roundedRect } from './canvasPanel';
import { DebugOverlay } from './debugOverlay';
import { Hud } from './hud';
import {
  DIFFICULTY_LABEL,
  PAUSE_POSITION_LABEL,
  PAUSE_SIDE_LABEL,
  STRINGS,
  formatClock,
  formatScore,
  formatSeconds,
} from './strings';

const DEG = 180 / Math.PI;
const GO_DURATION = 0.7;

function buttonLabel(id: ButtonId, s: Settings): [string, string?] {
  const t = STRINGS.settings;
  switch (id) {
    case 'calibrate':
    case 'start':
    case 'recenter':
    case 'settings':
    case 'pause':
    case 'resume':
    case 'newGame':
      return [STRINGS.buttons[id]];
    case 'set.dwell':
      return [t.dwell, formatSeconds(s.dwellTime)];
    case 'set.difficulty':
      return [t.difficulty, DIFFICULTY_LABEL[s.difficulty]];
    case 'set.floor':
      return [t.floor, s.floorObstacles ? t.on : t.off];
    case 'set.headUp':
      return [t.headUp, s.headUp ? t.on : t.off];
    case 'set.pausePos':
      return [t.pausePos, PAUSE_POSITION_LABEL[s.pausePosition]];
    case 'set.pauseSide':
      return [t.pauseSide, PAUSE_SIDE_LABEL[s.pauseSide]];
    case 'set.countdown':
      return [t.countdown, formatSeconds(s.countdown, 0)];
    case 'set.calibrate':
      return [t.calibrate, t.calibrateValue];
    case 'set.back':
      return [STRINGS.buttons.back];
    case 'set.debug':
      return [t.debug, s.debug ? t.on : t.off];
    case 'set.puck':
      return [t.puck, t.puckValue];
    case 'set.fps':
      return [t.fps, `${s.frameRate} Hz`];
    case 'puck.done':
      return [STRINGS.buttons.done];
  }
}

/** Smer k menu pauzy pre text v HUD. */
export function menuHint(s: Settings): string {
  if (s.pausePosition === 'top') return STRINGS.hud.menuUp;
  return s.pauseSide === 'left' ? STRINGS.hud.menuLeft : STRINGS.hud.menuRight;
}

export class UiManager {
  readonly root = new Group();
  readonly hud: Hud;
  readonly debug: DebugOverlay;
  readonly cursor = new GazeCursor();
  private readonly buttons = new Map<ButtonId, Button3D>();
  private readonly texts = new Map<TextId, CanvasPanel>();
  private readonly visible: GazeButton[] = [];
  private readonly recenterPanel = new CanvasPanel(30, 12);
  private layoutVersion = -1;
  private settingsVersion = -1;
  private countdownShown = -1;
  private recenterShown = -1;
  private calibrationError = false;
  private hudEyeHeight = -1;
  private readonly tmpPos = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpOffset = new Vector3();

  constructor(cfg: Config, playRoot: Group, scene: Scene) {
    this.hud = new Hud(cfg);
    this.debug = new DebugOverlay(cfg);
    playRoot.add(this.root, this.cursor.group, this.hud.panel.mesh, this.debug.panel.mesh);
    this.recenterPanel.mesh.visible = false;
    this.recenterPanel.mesh.renderOrder = 20;
    scene.add(this.recenterPanel.mesh);
  }

  update(game: Game, headWorld: HeadSample): void {
    if (game.layoutVersion !== this.layoutVersion) this.applyLayout(game);
    if (game.settingsVersion !== this.settingsVersion) {
      this.settingsVersion = game.settingsVersion;
      this.refreshLabels(game.settings);
    }
    if (game.eyeHeight !== this.hudEyeHeight) {
      this.hudEyeHeight = game.eyeHeight;
      this.hud.place(game.eyeHeight);
      const hud = this.hud.panel.mesh;
      this.debug.place(hud.position.x, hud.position.y, hud.scale.x);
    }

    const gaze = game.gaze;
    for (let i = 0; i < this.visible.length; i++) {
      const b = this.visible[i]!;
      const view = this.buttons.get(b.id)!;
      if (!game.layout.buttons.includes(b)) view.setLook('inactive');
      else if (gaze.focused === b) view.setLook('focus', gaze.progress);
      else view.setLook('idle');
    }
    this.cursor.update(gaze);
    this.updateDynamicTexts(game);
    this.hud.update(game, menuHint(game.settings));
    this.updateRecenter(game, headWorld);
  }

  updateDebug(dt: number, game: Game, drawCalls: number, ignoredInputs: number, xrHz: number): void {
    this.debug.update(dt, game, drawCalls, ignoredInputs, xrHz);
  }

  private applyLayout(game: Game): void {
    this.layoutVersion = game.layoutVersion;
    for (const view of this.buttons.values()) view.group.visible = false;
    for (const panel of this.texts.values()) panel.mesh.visible = false;
    this.visible.length = 0;
    const layout = game.layout;
    for (const b of layout.buttons) this.showButton(game, b);
    for (const b of layout.inactive) this.showButton(game, b);
    for (const t of layout.texts) {
      // Panel kalibrácie puku kreslí modul kamery (náhľad kamery a stav).
      if (t.id === 'puckInfo') continue;
      const panel = this.textPanel(t.id, t, game.eyeHeight);
      placeOnRect(panel.mesh, t);
      panel.mesh.visible = true;
      this.drawText(t.id, panel, game);
    }
    this.countdownShown = -1;
  }

  private showButton(game: Game, b: GazeButton): void {
    let view = this.buttons.get(b.id);
    if (!view) {
      view = new Button3D(b, Math.hypot(b.cx, b.cy - game.eyeHeight, b.cz));
      this.buttons.set(b.id, view);
      this.root.add(view.group);
      const [label, value] = buttonLabel(b.id, game.settings);
      view.setLabel(label, value);
    }
    view.place(b);
    view.group.visible = true;
    this.visible.push(b);
  }

  private refreshLabels(s: Settings): void {
    for (const [id, view] of this.buttons) {
      const [label, value] = buttonLabel(id, s);
      view.setLabel(label, value);
    }
  }

  private textPanel(id: TextId, r: Rect3, eyeHeight: number): CanvasPanel {
    let panel = this.texts.get(id);
    if (!panel) {
      const d = Math.hypot(r.cx, r.cy - eyeHeight, r.cz);
      panel = new CanvasPanel(2 * Math.atan(r.halfW / d) * DEG, 2 * Math.atan(r.halfH / d) * DEG);
      this.texts.set(id, panel);
      this.root.add(panel.mesh);
    }
    return panel;
  }

  private drawText(id: TextId, panel: CanvasPanel, game: Game): void {
    switch (id) {
      case 'setupInfo':
        this.calibrationError = game.calibrationError;
        drawInfo(panel, STRINGS.setup.title, game.calibrationError ? STRINGS.setup.error : STRINGS.setup.hint, game.calibrationError ? COLORS.warn : COLORS.muted);
        return;
      case 'readyInfo': {
        const d = game.settings.difficulty;
        drawInfo(
          panel,
          STRINGS.ready.title,
          STRINGS.ready.hint,
          COLORS.muted,
          `${STRINGS.ready.best} (${DIFFICULTY_LABEL[d]}): ${formatScore(game.best[d])}`,
        );
        return;
      }
      case 'pausedTitle':
        drawInfo(panel, STRINGS.paused.title, STRINGS.paused.reasons[game.pauseCause ?? 'button'], COLORS.warn);
        return;
      case 'settingsTitle':
        drawInfo(panel, STRINGS.settings.title, '', COLORS.muted);
        return;
      case 'results':
        drawResults(panel, game);
        return;
      case 'countdown':
        drawCountdown(panel, String(Math.max(1, Math.ceil(game.countdownLeft - 1e-9))));
        return;
      case 'puckInfo':
        return;
    }
  }

  private updateDynamicTexts(game: Game): void {
    const countdown = this.texts.get('countdown');
    if (countdown) {
      if (game.state === 'COUNTDOWN') {
        const n = Math.max(1, Math.ceil(game.countdownLeft - 1e-9));
        if (n !== this.countdownShown) {
          this.countdownShown = n;
          drawCountdown(countdown, String(n));
        }
      } else if (game.state === 'PLAYING' && game.stateTime < GO_DURATION) {
        if (this.countdownShown !== 0) {
          this.countdownShown = 0;
          drawCountdown(countdown, STRINGS.countdown.go);
        }
        countdown.mesh.visible = true;
      } else if (this.countdownShown === 0) {
        this.countdownShown = -1;
        countdown.mesh.visible = false;
      }
    }
    const setup = this.texts.get('setupInfo');
    if (setup && setup.mesh.visible && game.calibrationError !== this.calibrationError) {
      this.drawText('setupInfo', setup, game);
    }
  }

  /** Pokyn pri vycentrovaní je pripnutý k hlave: hráč sa práve otáča smerom hry. */
  private updateRecenter(game: Game, head: HeadSample): void {
    const active = game.sub === 'recenter' && game.centered;
    const panel = this.recenterPanel;
    panel.mesh.visible = active;
    if (!active) {
      this.recenterShown = -1;
      return;
    }
    const n = Math.max(1, Math.ceil(game.recenterLeft - 1e-9));
    if (n !== this.recenterShown) {
      this.recenterShown = n;
      panel.draw((ctx, w, h) => {
        roundedRect(ctx, 4, 4, w - 8, h - 8, h * 0.12, COLORS.panelBg, COLORS.panelBorder, 5);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitText(ctx, STRINGS.recenter.hint, w / 2, h * 0.3, w * 0.9, Math.round(h * 0.13), 700, COLORS.text);
        fitText(ctx, String(n), w / 2, h * 0.66, w * 0.5, Math.round(h * 0.42), 800, COLORS.accent);
      });
    }
    this.tmpQuat.set(head.qx, head.qy, head.qz, head.qw);
    this.tmpOffset.set(0, -0.15, -1.4).applyQuaternion(this.tmpQuat);
    this.tmpPos.set(head.px, head.py, head.pz).add(this.tmpOffset);
    panel.mesh.position.copy(this.tmpPos);
    panel.mesh.quaternion.copy(this.tmpQuat);
    const size = 2 * 1.4 * Math.tan((15 * Math.PI) / 180);
    panel.mesh.scale.set(size, size * 0.4, 1);
  }
}

function drawInfo(panel: CanvasPanel, title: string, hint: string, hintColor: string, extra = ''): void {
  panel.draw((ctx, w, h) => {
    roundedRect(ctx, 4, 4, w - 8, h - 8, Math.min(w, h) * 0.12, COLORS.panelBg, COLORS.panelBorder, 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = 1 + (hint ? 1 : 0) + (extra ? 1 : 0);
    const titleY = lines === 1 ? h * 0.52 : lines === 2 ? h * 0.36 : h * 0.27;
    fitText(ctx, title, w / 2, titleY, w * 0.9, Math.round(h * (lines === 1 ? 0.5 : 0.28)), 800, COLORS.text);
    if (hint) fitText(ctx, hint, w / 2, lines === 2 ? h * 0.7 : h * 0.57, w * 0.9, Math.round(h * 0.14), 600, hintColor);
    if (extra) fitText(ctx, extra, w / 2, h * 0.8, w * 0.9, Math.round(h * 0.12), 700, COLORS.accent);
  });
}

function drawCountdown(panel: CanvasPanel, text: string): void {
  panel.draw((ctx, w, h) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = h * 0.05;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.font = `900 ${Math.round(h * 0.7)}px ${FONT_FAMILY}`;
    ctx.strokeText(text, w / 2, h * 0.54);
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(text, w / 2, h * 0.54);
  });
}

function drawResults(panel: CanvasPanel, game: Game): void {
  const r = game.result;
  const t = STRINGS.gameOver;
  panel.draw((ctx, w, h) => {
    roundedRect(ctx, 4, 4, w - 8, h - 8, h * 0.08, COLORS.panelBg, COLORS.panelBorder, 4);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    fitText(ctx, t.title, w / 2, h * 0.12, w * 0.9, Math.round(h * 0.13), 800, COLORS.text);
    if (!r) return;
    fitText(ctx, formatScore(r.score), w / 2, h * 0.3, w * 0.9, Math.round(h * 0.17), 900, COLORS.accent);
    if (r.newBest) fitText(ctx, t.newBest, w / 2, h * 0.45, w * 0.9, Math.round(h * 0.09), 800, COLORS.warn);
    const rows: [string, string][] = [
      [t.time, formatClock(r.time)],
      [t.maxCombo, String(r.maxCombo)],
      [t.body, String(r.bodyPassed)],
      [t.floor, r.floorJudged > 0 ? `${r.floorHits} / ${r.floorJudged}` : String(r.floorPassed)],
    ];
    if (r.headUp) {
      rows.push([t.headUp, r.signalsSeen > 0 ? `${r.signalsSeen} · ⌀ ${formatSeconds(r.avgReaction)}` : '0']);
    }
    rows.push([`${t.best} (${DIFFICULTY_LABEL[r.difficulty]})`, formatScore(r.best)]);
    // So spoluhráčmi je o riadok viac: riadky sa zhustia, aby sa zmestili do panelu.
    const dense = rows.length > 5;
    const size = Math.round(h * (dense ? 0.068 : 0.075));
    rows.forEach(([label, value], i) => {
      const y = h * (dense ? 0.55 + i * 0.075 : 0.57 + i * 0.085);
      ctx.font = `600 ${size}px ${FONT_FAMILY}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(label, w * 0.58, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.text;
      ctx.font = `800 ${size}px ${FONT_FAMILY}`;
      ctx.fillText(value, w * 0.62, y);
    });
  });
}
