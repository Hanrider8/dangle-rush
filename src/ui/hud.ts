/**
 * HUD nad vzdialeným koncom dráhy: životy (pipy), skóre, násobiteľ, čas, puk a combo. Veľkosť je zadaná v uhloch,
 * takže je rovnako čitateľný pri ľubovoľnej vzdialenosti. Prekreslí sa len pri zmene hodnôt.
 * V Dekeri je to tabuľa bližšie pri podložke: zostávajúci čas namiesto životov, zásahy a combo.
 * Skóre s bonusom za čas sa mení 10× za sekundu: kvôli nemu a času sa HUD prekreslí najviac
 * 2× za sekundu (každé prekreslenie nahráva textúru do GPU). Životy, combo a puk hneď.
 */
import type { Config } from '../config';
import type { Game } from '../core/game';
import type { GameMode } from '../core/types';
import { comboMultiplier } from '../core/scoring';
import { COLORS, CORNER, CanvasPanel, DYNAMIC_TEXTURE, FONT_FAMILY, accentTick, roundedRect, spacedText } from './canvasPanel';
import { STRINGS, formatClock, formatScore } from './strings';

const DEG = Math.PI / 180;
const WIDTH_DEG = 14;
const HEIGHT_DEG = 4.6;
/** Najkratší čas medzi prekresleniami len kvôli skóre a času (ms). */
const SLOW_REFRESH_MS = 500;

/** Životy ako zvislé pipy (plné = zostávajúce). */
function pips(ctx: CanvasRenderingContext2D, x: number, cy: number, h: number, lives: number, total: number): void {
  const w = h * 0.34;
  const gap = h * 0.22;
  for (let i = 0; i < total; i++) {
    const px = x + i * (w + gap);
    if (i < lives) {
      ctx.fillStyle = lives === 1 ? COLORS.danger : COLORS.text;
      ctx.fillRect(px, cy - h / 2, w, h);
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, cy - h / 2 + 1, w - 2, h - 2);
    }
  }
}

/** Popisok (verzálky, rozostup) a hodnota za ním; x = ľavý okraj, align = kam sa dvojica zarovná. */
function stat(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  size: number,
  valueColor: string,
  align: 'left' | 'center' | 'right',
): void {
  const labelFont = `600 ${Math.round(size * 0.78)}px ${FONT_FAMILY}`;
  const valueFont = `700 ${size}px ${FONT_FAMILY}`;
  const spacing = Math.max(1, Math.round(size * 0.12));
  ctx.font = labelFont;
  const lw = ctx.measureText(label).width + spacing * label.length;
  ctx.font = valueFont;
  const vw = ctx.measureText(value).width;
  const pad = size * 0.4;
  const total = lw + pad + vw;
  const x0 = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
  ctx.textAlign = 'left';
  ctx.font = labelFont;
  ctx.fillStyle = COLORS.muted;
  spacedText(ctx, label, x0, y, spacing);
  ctx.font = valueFont;
  ctx.fillStyle = valueColor;
  ctx.fillText(value, x0 + lw + pad, y);
}

export class Hud {
  readonly panel = new CanvasPanel(WIDTH_DEG, HEIGHT_DEG, DYNAMIC_TEXTURE);
  /** Počet prekreslení (debug, testy v emulátore). */
  redraws = 0;
  private lastDraw = -Infinity;
  private lives = -1;
  private score = -1;
  private combo = -1;
  private floor = -1;
  private floorHits = -1;
  private floorMisses = -1;
  private seconds = -1;
  private deker = false;
  private paused = false;
  private hint = '';

  constructor(private readonly cfg: Config) {
    this.panel.mesh.visible = false;
  }

  /** Vzdialenosť HUD od hráča (debug overlay sa podľa nej zväčší alebo zmenší). */
  distance = 0;

  /**
   * DangleRush: nad koniec dráhy, nad najvyššiu prekážku. Deker: bližšie a pod úrovňou očí
   * (config.deker.hud), naklonený k hráčovi.
   */
  place(eyeHeight: number, mode: GameMode = 'rush'): void {
    const c = this.cfg;
    const deker = mode === 'deker';
    const d = deker ? c.deker.hud.distance : c.hud.distance;
    const scale = Math.tan(c.hud.fontDeg * DEG) / Math.tan(1.1 * DEG);
    const w = 2 * d * Math.tan((WIDTH_DEG / 2) * DEG) * scale;
    const h = 2 * d * Math.tan((HEIGHT_DEG / 2) * DEG) * scale;
    const m = this.panel.mesh;
    this.distance = d;
    m.scale.set(w, h, 1);
    if (deker) {
      const el = c.deker.hud.elevationDeg * DEG;
      m.position.set(0, eyeHeight + d * Math.sin(el), -d * Math.cos(el));
      m.rotation.set(el, 0, 0);
      return;
    }
    const tallest = Math.max(
      c.obstacles.sideBlock.topRatio * eyeHeight,
      c.obstacles.highBar.heightRatio * eyeHeight + 0.6,
    );
    m.position.set(0, tallest + c.hud.clearance + h / 2, -d);
    m.rotation.set(0, 0, 0);
  }

  update(game: Game, menuHint: string): void {
    const show = game.state === 'COUNTDOWN' || game.state === 'PLAYING' || game.state === 'PAUSED';
    this.panel.mesh.visible = show;
    if (!show) return;
    const sim = game.sim;
    const dk = game.deker;
    const deker = game.mode === 'deker';
    // Deker: životy nie sú, „puk“ sú zásahy / posúdené svetlá a čas sa odpočítava.
    const lives = deker ? 0 : sim.lives;
    const combo = deker ? dk.combo : sim.combo;
    const floorHits = deker ? dk.hits : sim.floorHits;
    const floorMisses = deker ? dk.misses : sim.floorMisses;
    const floor = deker ? dk.shown : sim.floorPassed;
    const score = Math.floor(deker ? dk.score : sim.score);
    const seconds = deker ? Math.ceil(dk.timeLeft - 1e-9) : Math.floor(sim.time);
    const paused = game.state === 'PAUSED';
    const hint = paused ? menuHint : '';
    const fastSame =
      deker === this.deker &&
      lives === this.lives &&
      combo === this.combo &&
      floor === this.floor &&
      floorHits === this.floorHits &&
      floorMisses === this.floorMisses &&
      paused === this.paused &&
      hint === this.hint;
    const now = performance.now();
    if (fastSame && ((score === this.score && seconds === this.seconds) || now - this.lastDraw < SLOW_REFRESH_MS)) return;
    this.lastDraw = now;
    this.redraws++;
    this.deker = deker;
    this.lives = lives;
    this.score = score;
    this.combo = combo;
    this.floor = floor;
    this.floorHits = floorHits;
    this.floorMisses = floorMisses;
    this.seconds = seconds;
    this.paused = paused;
    this.hint = hint;
    const multiplier = comboMultiplier(combo, this.cfg.rules);
    const totalLives = this.cfg.rules.lives;

    this.panel.draw((ctx, w, h) => {
      roundedRect(ctx, 2, 2, w - 4, h - 4, h * CORNER, COLORS.panelBg, COLORS.panelBorder, 2);
      accentTick(ctx, 2 + h * 0.12, 2, w * 0.1, Math.max(2, Math.round(h * 0.025)), paused ? COLORS.warn : COLORS.stripe);
      const row1 = h * 0.37;
      const row2 = h * 0.79;
      ctx.textBaseline = 'middle';

      if (deker) {
        // Zostávajúci čas kola; posledných 10 s červeno.
        ctx.textAlign = 'left';
        ctx.font = `700 ${Math.round(h * 0.3)}px ${FONT_FAMILY}`;
        ctx.fillStyle = seconds <= 10 ? COLORS.danger : COLORS.text;
        ctx.fillText(formatClock(seconds), w * 0.05, row1 + h * 0.01);
      } else {
        pips(ctx, w * 0.05, row1, h * 0.26, lives, totalLives);
      }
      ctx.textAlign = 'center';
      ctx.font = `700 ${Math.round(h * 0.42)}px ${FONT_FAMILY}`;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(formatScore(score), w * 0.5, row1 + h * 0.01);

      // Násobiteľ: odznak s okrajom, keď je combo aktívne.
      const badge = `×${multiplier}`;
      ctx.font = `700 ${Math.round(h * 0.24)}px ${FONT_FAMILY}`;
      const bw = ctx.measureText(badge).width + h * 0.2;
      const bh = h * 0.3;
      const bx = w * 0.95 - bw;
      if (multiplier > 1) roundedRect(ctx, bx, row1 - bh / 2, bw, bh, bh * 0.18, 'rgba(255, 199, 44, 0.14)', COLORS.accent, 2);
      ctx.fillStyle = multiplier > 1 ? COLORS.accent : COLORS.muted;
      ctx.fillText(badge, bx + bw / 2, row1 + h * 0.005);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(w * 0.04, h * 0.6, w * 0.92, 1);

      const small = Math.round(h * 0.17);
      if (paused) {
        // V pauze má spodný riadok celý pokyn, kde je menu.
        ctx.textAlign = 'center';
        ctx.font = `700 ${small}px ${FONT_FAMILY}`;
        ctx.fillStyle = COLORS.warn;
        spacedText(ctx, `${STRINGS.hud.paused} · ${hint}`, w * 0.5, row2, 1);
        return;
      }
      // S kamerou: prvky, ktorými puk prešiel / všetky posúdené; bez kamery len vzory, čo prešli plochou
      // (Deker: zásahy / posúdené svetlá, bez kamery počet svetiel).
      const judged = floorHits + floorMisses;
      const puck = judged > 0 ? `${floorHits}/${judged}` : String(floor);
      if (deker) {
        const label = judged > 0 ? STRINGS.hud.hits : STRINGS.hud.lights;
        stat(ctx, label.toUpperCase(), puck, w * 0.05, row2, small, COLORS.accent, 'left');
      } else {
        stat(ctx, STRINGS.hud.time.toUpperCase(), formatClock(sim.time), w * 0.05, row2, small, COLORS.text, 'left');
        stat(ctx, STRINGS.hud.puck.toUpperCase(), puck, w * 0.5, row2, small, COLORS.accent, 'center');
      }
      stat(ctx, STRINGS.hud.combo.toUpperCase(), String(combo), w * 0.95, row2, small, COLORS.text, 'right');
    });
  }
}
