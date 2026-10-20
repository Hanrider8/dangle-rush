/**
 * Prepínateľný debug overlay vedľa HUD: FPS, najdlhšia snímka (trhanie), stav automatu, výška hlavy,
 * uhol pohľadu k najbližšiemu tlačidlu, draw cally, počet ignorovaných vstupov a hlava hore (sklon pohľadu,
 * čakanie spoluhráča a eskalácia). V Dekeri namiesto hlavy hore puk z kamery: poloha, vzdialenosť od svetla
 * a vek záberu (ladenie sledovania). Posledný riadok: záseky (neskoré XR snímky) a čo robil snímok pred nimi.
 * Obnovuje sa 4× za sekundu.
 */
import type { Object3D } from 'three';
import type { Config } from '../config';
import type { Game } from '../core/game';
import { HITCH_EVENT, HITCH_TEXTURE, type HitchProbe } from '../xr/hitches';
import { COLORS, CanvasPanel, DYNAMIC_TEXTURE, fitText, roundedRect } from './canvasPanel';

const DEG = Math.PI / 180;
const WIDTH_DEG = 13;
const HEIGHT_DEG = 8;
/** Riadok textu v stupňoch (rovnaké písmo ako pri pôvodnom 6° paneli so 6 riadkami). */
const LINE_DEG = 0.89;
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

  /**
   * Záseky za 10 s (spolu) a najdlhší JS v slučke; posledný zásek: interval snímok, JS a kamera v snímku
   * pred ním a čo sa v ňom dialo.
   */
  private hitchLines(h: HitchProbe): [string, string] {
    const head = `záseky ${h.recent(performance.now())}/10 s (spolu ${h.total}) · JS max ${num(h.maxJs, 1)} ms`;
    if (h.total === 0) return [head, 'posledný zásek –'];
    const tags = [h.lastFlags & HITCH_TEXTURE ? 'textúra' : '', h.lastFlags & HITCH_EVENT ? 'udalosť' : ''].filter(Boolean).join(' + ') || 'nič';
    return [head, `posledný ${Math.round(h.lastInterval)} ms ← JS ${num(h.lastJs, 1)} · kamera ${num(h.lastCamera, 1)} ms · ${tags}`];
  }

  private dekerLine(game: Game): string {
    const d = game.deker;
    const light = d.lit ? `${num(d.targetX, 2)}; ${num(d.targetZ, 2)} · ${num(d.targetAge, 1)}/${num(d.timeout, 1)} s` : '–';
    return `deker ${d.difficulty}/${d.size} · svetlo ${light} · zásah do ${Math.round(d.hitRadius * 100)} cm · ${d.hits}/${d.misses}/${d.passes}`;
  }

  /** Puk z kamery v hernom priestore a jeho vzdialenosť od svietiaceho (alebo posledného) svetla. */
  private puckLine(game: Game, pitch: number): string {
    const p = game.puck;
    const d = game.deker;
    if (!p.valid) return `sklon ${Math.round(pitch)}° · puk nevidno`;
    const tx = d.lit ? d.targetX : d.lastX;
    const tz = d.lit ? d.targetZ : d.lastZ;
    const cm = Math.round(Math.hypot(p.x - tx, p.z - tz) * 100);
    return `sklon ${Math.round(pitch)}° · puk ${num(p.x, 2)}; ${num(p.z, 2)} · ${cm} cm od svetla · vek ${Math.round(p.age * 1000)} ms`;
  }

  /** xrHz = obnovovacia frekvencia, ktorú hlási XR session (0 = nevedno), hzNote = automatický ústup. */
  update(dt: number, game: Game, drawCalls: number, ignoredInputs: number, xrHz: number, hzNote: string, hitches: HitchProbe): void {
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
      game.mode === 'deker' ? this.dekerLine(game) : `${sim.difficulty} · ${num(sim.speed, 1)} m/s · vlna ${num(sim.interval, 1)} s · prekážky ${activeCount(sim.obstacles)}`,
      game.mode === 'deker'
        ? this.puckLine(game, pitch)
        : `sklon ${Math.round(pitch)}° · spoluhráč ${headUp.active ? `čaká ${num(headUp.age, 1)} s · eskalácia ${Math.round(headUp.escalation() * 100)} %` : '–'} · zachytení ${headUp.seen}`,
      ...this.hitchLines(hitches),
    ];
    this.panel.draw((ctx, w, h) => {
      roundedRect(ctx, 4, 4, w - 8, h - 8, h * 0.08, 'rgba(0, 0, 0, 0.72)', 'rgba(255, 179, 71, 0.8)', 3);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Dlhý riadok sa zmenší, aby sa zmestil do panelu.
      const line = (h * LINE_DEG) / HEIGHT_DEG;
      const size = Math.round(h * (0.6 / HEIGHT_DEG));
      lines.forEach((text, i) => fitText(ctx, text, w * 0.04, h * 0.09 + i * line, w * 0.92, size, 600, COLORS.text));
    });
  }
}
