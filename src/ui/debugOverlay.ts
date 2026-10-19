/**
 * Prepínateľný debug overlay vedľa HUD: FPS, najdlhšia snímka (trhanie), stav automatu, výška hlavy,
 * uhol pohľadu k najbližšiemu tlačidlu, draw cally, počet ignorovaných vstupov a hlava hore (sklon pohľadu,
 * čakanie spoluhráča a eskalácia). Obnovuje sa 4× za sekundu.
 */
import type { Config } from '../config';
import type { Game } from '../core/game';
import { COLORS, CanvasPanel, FONT_FAMILY, roundedRect } from './canvasPanel';

const DEG = Math.PI / 180;
const WIDTH_DEG = 13;
const HEIGHT_DEG = 6;
const REFRESH = 0.25;

function num(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

export class DebugOverlay {
  readonly panel = new CanvasPanel(WIDTH_DEG, HEIGHT_DEG);
  private time = 0;
  private frames = 0;
  private fps = 0;
  private maxDt = 0;
  private shownMaxMs = 0;

  constructor(private readonly cfg: Config) {
    const d = cfg.hud.distance;
    const w = 2 * d * Math.tan((WIDTH_DEG / 2) * DEG);
    const h = 2 * d * Math.tan((HEIGHT_DEG / 2) * DEG);
    this.panel.mesh.scale.set(w, h, 1);
    this.panel.mesh.visible = false;
  }

  /** Umiestni overlay vľavo od HUD, v rovnakej výške. */
  place(hudX: number, hudY: number, hudWidth: number): void {
    const w = this.panel.mesh.scale.x;
    this.panel.mesh.position.set(hudX - hudWidth / 2 - 0.15 - w / 2, hudY, -this.cfg.hud.distance);
  }

  /** xrHz = obnovovacia frekvencia, ktorú hlási XR session (0 = nevedno). */
  update(dt: number, game: Game, drawCalls: number, ignoredInputs: number, xrHz: number): void {
    const show = game.settings.debug;
    this.panel.mesh.visible = show;
    this.frames++;
    this.time += dt;
    if (dt > this.maxDt) this.maxDt = dt;
    if (this.time < REFRESH) return;
    this.fps = this.frames / this.time;
    this.shownMaxMs = this.maxDt * 1000;
    this.frames = 0;
    this.time = 0;
    this.maxDt = 0;
    if (!show) return;

    const sim = game.sim;
    const gaze = game.gaze;
    const headUp = sim.headUp;
    const pitch = Math.asin(Math.max(-1, Math.min(1, game.headFwd.y))) / DEG;
    const lines = [
      `FPS ${Math.round(this.fps)} / ${xrHz ? Math.round(xrHz) : '?'} Hz · max ${Math.round(this.shownMaxMs)} ms · ${game.state}/${game.sub}`,
      `hlava y ${num(game.head.y, 2)} m · kalibrácia ${num(game.eyeHeight, 2)} m`,
      `pohľad → tlačidlo ${gaze.nearestAngleDeg < 180 ? `${num(gaze.nearestAngleDeg, 1)}°` : '–'}${gaze.focusedId ? ` (${gaze.focusedId} ${Math.round(gaze.progress * 100)} %)` : ''}`,
      `draw cally ${drawCalls} · ignorované vstupy ${ignoredInputs}`,
      `úroveň ${num(sim.level, 2)} · ${num(sim.speed, 1)} m/s · prekážky ${sim.obstacles.filter((o) => o.active).length}`,
      `sklon ${Math.round(pitch)}° · spoluhráč ${headUp.active ? `čaká ${num(headUp.age, 1)} s · eskalácia ${Math.round(headUp.escalation() * 100)} %` : '–'} · zachytení ${headUp.seen}`,
    ];
    this.panel.draw((ctx, w, h) => {
      roundedRect(ctx, 4, 4, w - 8, h - 8, h * 0.08, 'rgba(0, 0, 0, 0.72)', 'rgba(255, 179, 71, 0.8)', 3);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(h * 0.1)}px ${FONT_FAMILY}`;
      ctx.fillStyle = COLORS.text;
      lines.forEach((line, i) => ctx.fillText(line, w * 0.04, h * (0.13 + i * 0.148)));
    });
  }
}
