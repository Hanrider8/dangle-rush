/**
 * 3D tlačidlo ovládané pohľadom: tmavomodrý panel (CanvasTexture) s popisom. Pri pohľade sa jemne
 * rozžiari a po spodnej hrane sa plní zlatá linka podľa dwell (mierka meshu, textúra sa neprekresľuje).
 * Popis sa prekreslí len pri zmene textu.
 */
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Rect3 } from '../core/types';
import { COLORS, CORNER, CanvasPanel, UNIT_PLANE, fitText, placeOnRect, roundedRect } from './canvasPanel';

/** Linka progresu: výška a okraj voči rozmerom tlačidla. */
const BAR_H = 0.06;
const BAR_INSET = 0.06;

export type ButtonLook = 'idle' | 'focus' | 'inactive';

const DEG = 180 / Math.PI;

export class Button3D {
  readonly group = new Group();
  private readonly panel: CanvasPanel;
  private readonly glow: Mesh<typeof UNIT_PLANE, MeshBasicMaterial>;
  private readonly bar: Mesh<typeof UNIT_PLANE, MeshBasicMaterial>;
  private label = '';
  private value = '';
  private look: ButtonLook | null = null;

  /** Veľkosť canvasu sa určí z uhlovej veľkosti prvého umiestnenia. */
  constructor(rect: Rect3, distance: number) {
    const wDeg = 2 * Math.atan(rect.halfW / distance) * DEG;
    const hDeg = 2 * Math.atan(rect.halfH / distance) * DEG;
    this.panel = new CanvasPanel(wDeg, hDeg);
    this.glow = new Mesh(
      UNIT_PLANE,
      new MeshBasicMaterial({
        color: 0xffc72c,
        transparent: true,
        opacity: 0.2,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.position.z = -0.002;
    this.glow.scale.set(1.04, 1.1, 1);
    this.glow.renderOrder = 9;
    this.glow.visible = false;
    this.bar = new Mesh(
      UNIT_PLANE,
      new MeshBasicMaterial({ color: 0xffc72c, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.bar.position.set(0, -0.5 + BAR_INSET + BAR_H / 2, 0.001);
    this.bar.renderOrder = 11;
    this.bar.visible = false;
    this.group.add(this.glow, this.panel.mesh, this.bar);
  }

  setLabel(label: string, value = ''): void {
    if (label === this.label && value === this.value) return;
    this.label = label;
    this.value = value;
    this.panel.draw((ctx, w, h) => {
      const pad = Math.round(h * 0.06);
      roundedRect(ctx, pad, pad, w - 2 * pad, h - 2 * pad, h * CORNER * 1.6, COLORS.panelBg, COLORS.panelBorder, Math.max(2, h * 0.025));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = w - 6 * pad;
      if (value) {
        // Dvojriadkové tlačidlo (nastavenia) je úzke: popis bez verzálok, aby ostal čitateľný.
        fitText(ctx, label, w / 2, h * 0.35, maxW, Math.round(h * 0.25), 600, COLORS.muted);
        fitText(ctx, value, w / 2, h * 0.64, maxW, Math.round(h * 0.32), 700, COLORS.accent);
      } else {
        fitText(ctx, label.toUpperCase(), w / 2, h * 0.52, maxW, Math.round(h * 0.36), 700, COLORS.text);
      }
    });
  }

  place(rect: Rect3): void {
    placeOnRect(this.group, rect, 0.003);
  }

  setLook(look: ButtonLook, progress = 0): void {
    if (look !== this.look) {
      this.look = look;
      const m = this.panel.mesh.material;
      m.color.setScalar(look === 'focus' ? 1.15 : look === 'inactive' ? 0.6 : 1);
      m.opacity = look === 'inactive' ? 0.45 : 1;
      this.glow.visible = look === 'focus';
      this.bar.visible = look === 'focus';
    }
    if (look === 'focus') {
      this.glow.material.opacity = 0.08 + 0.17 * progress;
      const p = Math.max(0.001, progress);
      const full = 1 - 2 * BAR_INSET;
      this.bar.scale.set(full * p, BAR_H, 1);
      this.bar.position.x = -full / 2 + (full * p) / 2;
    }
  }
}
