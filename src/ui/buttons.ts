/**
 * 3D tlačidlo ovládané pohľadom: CanvasTexture s popisom a žiara pri plnení.
 * Stav sa mení len farbou a viditeľnosťou meshov, popis sa prekreslí len pri zmene textu.
 */
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Rect3 } from '../core/types';
import { COLORS, CanvasPanel, UNIT_PLANE, fitText, placeOnRect, roundedRect } from './canvasPanel';

export type ButtonLook = 'idle' | 'focus' | 'inactive';

const DEG = 180 / Math.PI;

export class Button3D {
  readonly group = new Group();
  private readonly panel: CanvasPanel;
  private readonly glow: Mesh<typeof UNIT_PLANE, MeshBasicMaterial>;
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
        color: 0x2bff88,
        transparent: true,
        opacity: 0.35,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.position.z = -0.002;
    this.glow.scale.set(1.08, 1.22, 1);
    this.glow.renderOrder = 9;
    this.glow.visible = false;
    this.group.add(this.glow, this.panel.mesh);
  }

  setLabel(label: string, value = ''): void {
    if (label === this.label && value === this.value) return;
    this.label = label;
    this.value = value;
    this.panel.draw((ctx, w, h) => {
      const pad = Math.round(h * 0.06);
      roundedRect(ctx, pad, pad, w - 2 * pad, h - 2 * pad, h * 0.22, COLORS.panelBg, COLORS.panelBorder, Math.max(3, h * 0.035));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = w - 6 * pad;
      if (value) {
        fitText(ctx, label, w / 2, h * 0.36, maxW, Math.round(h * 0.26), 600, COLORS.muted);
        fitText(ctx, value, w / 2, h * 0.68, maxW, Math.round(h * 0.32), 800, COLORS.accent);
      } else {
        fitText(ctx, label, w / 2, h * 0.53, maxW, Math.round(h * 0.42), 800, COLORS.text);
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
      m.color.setScalar(look === 'focus' ? 1.2 : look === 'inactive' ? 0.6 : 1);
      m.opacity = look === 'inactive' ? 0.45 : 1;
      this.glow.visible = look === 'focus';
    }
    if (look === 'focus') this.glow.material.opacity = 0.12 + 0.38 * progress;
  }
}
