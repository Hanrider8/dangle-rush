/**
 * Panel s textom kresleným do CanvasTexture. Prekresľuje sa len pri zmene obsahu.
 * Geometria je jednotková rovina; veľkosť a poloha sa nastavujú cez place() podľa Rect3.
 */
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import type { Rect3 } from '../core/types';

/**
 * Úzke športové písmo: na Queste (Android) je systémové Roboto Condensed („sans-serif-condensed“),
 * inde náhrada. Žiadne externé fonty.
 */
export const FONT_FAMILY =
  '"Roboto Condensed", sans-serif-condensed, "Arial Narrow", "Segoe UI", Roboto, system-ui, sans-serif';

/** Zdieľaná jednotková rovina pre všetky panely. */
export const UNIT_PLANE = new PlaneGeometry(1, 1);

const PX_PER_DEG = 40;
const MAX_PX = 1024;

export interface PanelOptions {
  /** Rozlíšenie canvasu na stupeň zorného poľa. */
  pxPerDeg?: number;
  /** Mipmapy (ostrejšie pri zmenšení, ale každé prekreslenie ich generuje znova). */
  mipmaps?: boolean;
}

/**
 * Pre panely, ktoré sa prekresľujú počas hry (HUD, debug): rozlíšenie blízke displeju Questu 3
 * (~25 px/°) a bez mipmáp, aby nahratie textúry do GPU bolo čo najlacnejšie.
 */
export const DYNAMIC_TEXTURE: PanelOptions = { pxPerDeg: 28, mipmaps: false };

const basis = new Matrix4();
const u = new Vector3();
const v = new Vector3();
const n = new Vector3();

/** Umiestni objekt na obdĺžnik (rovina otočená k hráčovi), prípadne o kúsok bližšie k nemu. */
export function placeOnRect(obj: Object3D, r: Rect3, towardViewer = 0, scale = true): void {
  u.set(r.ux, r.uy, r.uz);
  v.set(r.vx, r.vy, r.vz);
  n.set(r.nx, r.ny, r.nz);
  basis.makeBasis(u, v, n);
  obj.quaternion.setFromRotationMatrix(basis);
  obj.position.set(r.cx + r.nx * towardViewer, r.cy + r.ny * towardViewer, r.cz + r.nz * towardViewer);
  if (scale) obj.scale.set(r.halfW * 2, r.halfH * 2, 1);
}

export class CanvasPanel {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;

  /** Rozlíšenie podľa uhlovej veľkosti (pomer strán sa nemení s vzdialenosťou). */
  constructor(widthDeg: number, heightDeg: number, opts: PanelOptions = {}) {
    const pxPerDeg = opts.pxPerDeg ?? PX_PER_DEG;
    let w = widthDeg * pxPerDeg;
    let h = heightDeg * pxPerDeg;
    const fit = Math.min(1, MAX_PX / Math.max(w, h));
    w = Math.round(w * fit);
    h = Math.round(h * fit);
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    if (opts.mipmaps === false) {
      this.texture.generateMipmaps = false;
      this.texture.minFilter = LinearFilter;
    } else {
      this.texture.minFilter = LinearMipmapLinearFilter;
      this.texture.anisotropy = 4;
    }
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(UNIT_PLANE, material);
    this.mesh.renderOrder = 10;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }
}

/** Zaoblený obdĺžnik s výplňou a okrajom. */
export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
  lineWidth = 4,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Text zmenšený tak, aby sa zmestil do šírky. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  sizePx: number,
  weight = 700,
  color = '#ffffff',
): void {
  let size = sizePx;
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) {
    size = Math.floor((size * maxWidth) / width);
    ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Paleta UI (zhodná s PALETTE v render/materials.ts): tmavé sklo, biela, cyan akcent, červená len pri chybe. */
export const COLORS = {
  panelBg: 'rgba(8, 12, 18, 0.82)',
  panelBorder: 'rgba(255, 255, 255, 0.16)',
  text: '#f2f6fa',
  muted: '#8fa3b8',
  accent: '#3fd0ff',
  warn: '#ffb347',
  danger: '#ff3b4e',
};

/** Polomer rohov panelov voči ich výške (hranatejší vzhľad). */
export const CORNER = 0.07;

/** Tenká akcentová linka pri hornej hrane panelu (vľavo), ako v športovej grafike. */
export function accentTick(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = COLORS.accent): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Text s rozostupom písmen (popisky verzálkami); kde prehliadač letterSpacing nepozná, kreslí sa bez neho. */
export function spacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacingPx: number): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const before = c.letterSpacing;
  if (before !== undefined) c.letterSpacing = `${spacingPx}px`;
  ctx.fillText(text, x, y);
  if (before !== undefined) c.letterSpacing = before;
}
