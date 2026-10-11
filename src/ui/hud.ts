/**
 * HUD nad vzdialeným koncom dráhy: životy, skóre, combo, čas. Veľkosť je zadaná v uhloch,
 * takže je rovnako čitateľný pri ľubovoľnej vzdialenosti. Prekreslí sa len pri zmene hodnôt.
 */
import type { Config } from '../config';
import type { Game } from '../core/game';
import { comboMultiplier } from '../core/scoring';
import { COLORS, CanvasPanel, FONT_FAMILY, roundedRect } from './canvasPanel';
import { STRINGS, formatClock, formatScore } from './strings';

const DEG = Math.PI / 180;
const WIDTH_DEG = 14;
const HEIGHT_DEG = 4.6;

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.fillStyle = fill;
  ctx.fill();
}

export class Hud {
  readonly panel = new CanvasPanel(WIDTH_DEG, HEIGHT_DEG);
  private lives = -1;
  private score = -1;
  private combo = -1;
  private seconds = -1;
  private paused = false;
  private hint = '';

  constructor(private readonly cfg: Config) {
    this.panel.mesh.visible = false;
  }

  /** Umiestni HUD nad koniec dráhy, nad najvyššiu prekážku. */
  place(eyeHeight: number): void {
    const c = this.cfg;
    const d = c.hud.distance;
    const scale = Math.tan(c.hud.fontDeg * DEG) / Math.tan(1.1 * DEG);
    const w = 2 * d * Math.tan((WIDTH_DEG / 2) * DEG) * scale;
    const h = 2 * d * Math.tan((HEIGHT_DEG / 2) * DEG) * scale;
    const tallest = Math.max(
      c.obstacles.sideBlock.topRatio * eyeHeight,
      c.obstacles.highBar.heightRatio * eyeHeight + 0.6,
    );
    this.panel.mesh.scale.set(w, h, 1);
    this.panel.mesh.position.set(0, tallest + c.hud.clearance + h / 2, -d);
    this.panel.mesh.rotation.set(0, 0, 0);
  }

  update(game: Game, menuHint: string): void {
    const show = game.state === 'COUNTDOWN' || game.state === 'PLAYING' || game.state === 'PAUSED';
    this.panel.mesh.visible = show;
    if (!show) return;
    const sim = game.sim;
    const score = Math.floor(sim.score);
    const seconds = Math.floor(sim.time);
    const paused = game.state === 'PAUSED';
    const hint = paused ? menuHint : '';
    if (
      sim.lives === this.lives &&
      score === this.score &&
      sim.combo === this.combo &&
      seconds === this.seconds &&
      paused === this.paused &&
      hint === this.hint
    ) {
      return;
    }
    this.lives = sim.lives;
    this.score = score;
    this.combo = sim.combo;
    this.seconds = seconds;
    this.paused = paused;
    this.hint = hint;
    const multiplier = comboMultiplier(sim.combo, this.cfg.rules);
    const totalLives = this.cfg.rules.lives;

    this.panel.draw((ctx, w, h) => {
      roundedRect(ctx, 4, 4, w - 8, h - 8, h * 0.18, 'rgba(8, 14, 26, 0.72)', 'rgba(120, 210, 255, 0.6)', 4);
      const row1 = h * 0.36;
      const row2 = h * 0.76;
      const big = Math.round(h * 0.34);
      const small = Math.round(h * 0.2);
      ctx.textBaseline = 'middle';

      const s = h * 0.28;
      for (let i = 0; i < totalLives; i++) {
        heart(ctx, w * 0.07 + i * s * 1.15, row1 - s * 0.5, s, i < sim.lives ? COLORS.danger : 'rgba(255,255,255,0.18)');
      }
      ctx.textAlign = 'center';
      ctx.font = `800 ${big}px ${FONT_FAMILY}`;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(formatScore(score), w * 0.5, row1);
      ctx.textAlign = 'right';
      ctx.font = `800 ${Math.round(big * 0.8)}px ${FONT_FAMILY}`;
      ctx.fillStyle = multiplier > 1 ? COLORS.accent : COLORS.muted;
      ctx.fillText(`×${multiplier}`, w * 0.95, row1);

      ctx.font = `600 ${small}px ${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`${STRINGS.hud.time} ${formatClock(sim.time)}`, w * 0.05, row2);
      ctx.textAlign = 'right';
      ctx.fillText(`${STRINGS.hud.combo} ${sim.combo}`, w * 0.95, row2);
      if (paused) {
        ctx.textAlign = 'center';
        ctx.font = `800 ${small}px ${FONT_FAMILY}`;
        ctx.fillStyle = COLORS.warn;
        ctx.fillText(`${STRINGS.hud.paused} · ${hint}`, w * 0.5, row2);
      }
    });
  }
}
