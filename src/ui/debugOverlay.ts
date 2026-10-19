/**
 * Prepínateľný debug overlay vedľa HUD: FPS, najdlhšia snímka (trhanie), stav automatu, výška hlavy,
 * uhol pohľadu k najbližšiemu tlačidlu, draw cally, počet ignorovaných vstupov a hlava hore (sklon pohľadu,
 * čakanie spoluhráča a eskalácia). Obnovuje sa 4× za sekundu.
 */
import type { Object3D } from 'three';
import type { Config } from '../config';
import type { Game } from '../core/game';
import { COLORS, CanvasPanel, DYNAMIC_TEXTURE, FONT_FAMILY, roundedRect } from './canvasPanel';

const DEG = Math.PI / 180;
const WIDTH_DEG = 13;
const HEIGHT_DEG = 6;
const REFRESH = 0.25;

function activeCount(list: readonly { active: boolean }[]): number {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i]!.active) n++;
  return n;
}

function num(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

export class DebugOverlay {
  readonly panel = new CanvasPanel(WIDTH_DEG, HEIGHT_DEG, DYNAMIC_TEXTURE);
  private time = 0;
  private frames = 0;
  private fps = 0;
  private maxDt = 0;
  private shownMaxMs = 0;

  constructor(private readonly cfg: Config) {
    this.panel.mesh.visible = false;
  }

  /** Umiestni overlay vľavo od HUD, v rovnakej rovine; uhlová veľkosť nezávisí od vzdialenosti HUD. */
  place(hud: Object3D, hudDistance: number): void {
    const m = this.panel.mesh;
    const w = 2 * hudDistance * Math.tan((WIDTH_DEG / 2) * DEG);
    const h = 2 * hudDistance * Math.tan((HEIGHT_DEG / 2) * DEG);
    const gap = 0.15 * (hudDistance / this.cfg.hud.distance);
    m.scale.set(w, h, 1);
    m.rotation.copy(hud.rotation);
    m.position.set(hud.position.x - hud.scale.x / 2 - gap - w / 2, hud.position.y, hud.position.z);
  }

  /** xrHz = obnovovacia frekvencia, ktorú hlási XR session (0 = nevedno), hzNote = automatický ústup. */
  update(dt: number, game: Game, drawCalls: number, ignoredInputs: number, xrHz: number, hzNote: string): void {
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
      `FPS ${Math.round(this.fps)} / ${xrHz ? Math.round(xrHz) : '?'} Hz${hzNote} · max ${Math.round(this.shownMaxMs)} ms · ${game.state}/${game.sub}`,
      `hlava y ${num(game.head.y, 2)} m · kalibrácia ${num(game.eyeHeight, 2)} m`,
      `pohľad → tlačidlo ${gaze.nearestAngleDeg < 180 ? `${num(gaze.nearestAngleDeg, 1)}°` : '–'}${gaze.focusedId ? ` (${gaze.focusedId} ${Math.round(gaze.progress * 100)} %)` : ''}`,
      `draw cally ${drawCalls} · ignorované vstupy ${ignoredInputs}`,
      game.mode === 'deker'
        ? `deker ${game.deker.difficulty} · svetlo ${game.deker.target} ${num(game.deker.targetAge, 1)}/${num(game.deker.timeout, 1)} s · ${game.deker.hits}/${game.deker.misses}/${game.deker.passes}`
        : `${sim.difficulty} · ${num(sim.speed, 1)} m/s · vlna ${num(sim.interval, 1)} s · prekážky ${activeCount(sim.obstacles)}`,
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
