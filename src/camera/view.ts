/**
 * Zobrazenie testu kamery v AR:
 * - krúžok na podlahe tam, kde je podľa kamery puk (zelený čerstvý, žltý starší),
 * - obrys toho, čo kamera práve vidí na podlahe,
 * - panel vľavo vpredu s náhľadom kamery (pixely farby puku fialovo) a číslami.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Group,
  type Scene,
} from 'three';
import type { Config } from '../config';
import type { FrameStats } from './frameStats';
import type { Game } from '../core/game';
import type { HeadSample } from '../core/types';
import { COLORS, CanvasPanel, FONT_FAMILY, roundedRect } from '../ui/canvasPanel';
import type { CameraSource } from './source';
import type { PuckTracker } from './tracker';

const FOOT_PER_EDGE = 12;
const RING_RADIUS = 0.06;
/** Panel: uhlová veľkosť pre rozlíšenie canvasu, skutočná šírka v metroch a poloha v hernom priestore. */
const PANEL_DEG = { w: 16, h: 17.5 };
const PANEL_WIDTH = 0.8;
const PANEL_POS = { x: -1.25, dy: -0.35, z: -1.35 };
/** Panel sa prekreslí najviac takto často (textúra 640 × 700 sa nahráva do GPU). */
const REDRAW_INTERVAL = 0.2;
const GREEN = 0x2bff88;
const YELLOW = 0xffd84d;

function num(value: number, decimals = 0): string {
  return value.toFixed(decimals).replace('.', ',').replace('-', '−');
}

export class TrackerView {
  readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly footprint: LineLoop<BufferGeometry, LineBasicMaterial>;
  readonly panel = new CanvasPanel(PANEL_DEG.w, PANEL_DEG.h);
  private readonly footXZ = new Float32Array(FOOT_PER_EDGE * 8);
  private readonly footPos: BufferAttribute;
  private preview: ImageBitmap | null = null;
  private textTimer = 0;
  private dirty = true;

  constructor(
    private readonly cfg: Config,
    scene: Scene,
    playRoot: Group,
  ) {
    this.ring = new Mesh(
      new RingGeometry(RING_RADIUS - 0.007, RING_RADIUS + 0.007, 48).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.95, depthWrite: false, side: DoubleSide }),
    );
    this.ring.renderOrder = 30;
    this.ring.visible = false;
    scene.add(this.ring);

    this.footPos = new BufferAttribute(new Float32Array(FOOT_PER_EDGE * 4 * 3), 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.footPos);
    this.footprint = new LineLoop(
      geometry,
      new LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.footprint.frustumCulled = false;
    this.footprint.renderOrder = 29;
    this.footprint.visible = false;
    scene.add(this.footprint);

    this.panel.mesh.visible = false;
    playRoot.add(this.panel.mesh);
  }

  /** Nový náhľad z workera (predošlý sa uvoľní). */
  setPreview(bitmap: ImageBitmap): void {
    this.preview?.close();
    this.preview = bitmap;
    this.dirty = true;
  }

  update(
    dt: number,
    nowMs: number,
    tracker: PuckTracker,
    source: CameraSource,
    game: Game,
    head: HeadSample,
    xr: FrameStats,
  ): void {
    const running = source.stream !== null;
    const p = tracker.puck;
    const age = nowMs - p.received;
    const ringCfg = this.cfg.camera.ring;
    this.ring.visible = running && p.valid && age < ringCfg.hideMs;
    if (this.ring.visible) {
      this.ring.position.set(p.x, 0.004, p.z);
      const s = (tracker.targetRadius + 0.02) / RING_RADIUS;
      this.ring.scale.set(s, 1, s);
      this.ring.material.color.setHex(age < ringCfg.freshMs ? GREEN : YELLOW);
    }

    this.footprint.visible = running && head.valid && tracker.stats.frames > 0;
    if (this.footprint.visible) {
      const n = tracker.model.footprint(head, 0.003, 6, FOOT_PER_EDGE, this.footXZ);
      const pos = this.footPos.array as Float32Array;
      for (let i = 0; i < n; i++) {
        pos[3 * i] = this.footXZ[2 * i]!;
        pos[3 * i + 1] = 0.003;
        pos[3 * i + 2] = this.footXZ[2 * i + 1]!;
      }
      this.footPos.needsUpdate = true;
    }

    // Počas hry je panel skrytý a neprekresľuje sa: nahrávanie textúry 640 × 700 do GPU by hru trhalo.
    const mesh = this.panel.mesh;
    mesh.visible = running && game.state !== 'PLAYING' && game.state !== 'COUNTDOWN';
    if (!mesh.visible) return;
    mesh.position.set(PANEL_POS.x, game.eyeHeight + PANEL_POS.dy, PANEL_POS.z);
    mesh.rotation.set(0, Math.atan2(-PANEL_POS.x, -PANEL_POS.z), 0);
    mesh.scale.set(PANEL_WIDTH, (PANEL_WIDTH * this.panel.height) / this.panel.width, 1);
    this.textTimer += dt;
    if (this.textTimer < REDRAW_INTERVAL || (!this.dirty && this.textTimer < 2 * REDRAW_INTERVAL)) return;
    this.textTimer = 0;
    this.dirty = false;
    this.redraw(this.lines(tracker, nowMs, xr));
  }

  private lines(tracker: PuckTracker, nowMs: number, xr: FrameStats): [string, string][] {
    const s = tracker.stats;
    const p = tracker.puck;
    const fresh = p.valid && nowMs - p.received < this.cfg.camera.ring.hideMs;
    const live = nowMs - s.lastFrameAt < 1000;
    const rows: [string, string][] = [];
    rows.push([
      live
        ? `Kamera ${s.srcWidth}×${s.srcHeight} · ${num(s.fps)} fps · ${num(s.procMs, 1)} ms ${s.method}`
        : 'Kamera: snímky neprichádzajú',
      live ? COLORS.text : COLORS.warn,
    ]);
    rows.push([
      `Puk v zábere ${num(s.foundRate * 100)} % · polomer ${num(p.radius)} px, čakaný ${num(p.expectedRadius)} px`,
      s.foundRate > 0.5 ? COLORS.text : COLORS.warn,
    ]);
    rows.push([
      fresh
        ? `Poloha x ${num(p.playX, 2)} · z ${num(p.playZ, 2)} m · rozptyl ${Number.isFinite(s.spreadCm) ? num(s.spreadCm, 1) : '–'} cm`
        : 'Poloha –',
      fresh ? COLORS.accent : COLORS.muted,
    ]);
    const cal = tracker.calib;
    const calibrated = tracker.paramsSource === 'kalibrácia';
    rows.push([`Kalibrácia: ${cal.solving ? 'počítam…' : cal.status}`, calibrated ? COLORS.accent : COLORS.warn]);
    if (!calibrated) {
      const last = cal.last;
      rows.push([
        last
          ? `Pokrytie ${num(last.coverageU * 100)}/${num(last.coverageV * 100)} % · hlava ${num(last.headRangeDeg)}°`
          : 'Polož puk ~1 m pred seba, pozeraj sa okolo neho',
        COLORS.muted,
      ]);
    } else {
      rows.push([
        `Hra ${num(xr.fps)} fps · trhnutia ${num(xr.hitchRate * 100, 1)} % · najdlhšia ${num(xr.worstMs)} ms`,
        xr.hitchRate > 0.02 ? COLORS.warn : COLORS.muted,
      ]);
    }
    return rows;
  }

  private redraw(rows: [string, string][]): void {
    const preview = this.preview;
    this.panel.draw((ctx, w, h) => {
      roundedRect(ctx, 3, 3, w - 6, h - 6, 18, 'rgba(0, 0, 0, 0.78)', 'rgba(43, 255, 136, 0.8)', 3);
      const pad = 14;
      const boxW = w - 2 * pad;
      const boxH = Math.round((boxW * 3) / 4);
      if (preview) {
        const scale = Math.min(boxW / preview.width, boxH / preview.height);
        const dw = preview.width * scale;
        const dh = preview.height * scale;
        ctx.drawImage(preview, pad + (boxW - dw) / 2, pad + (boxH - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = COLORS.muted;
        ctx.font = `600 30px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText('Čakám na kameru…', w / 2, pad + boxH / 2);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lineH = (h - pad - boxH - 2 * pad) / rows.length;
      rows.forEach(([text, color], i) => {
        ctx.font = `600 ${Math.round(lineH * 0.62)}px ${FONT_FAMILY}`;
        ctx.fillStyle = color;
        let size = Math.round(lineH * 0.62);
        while (ctx.measureText(text).width > boxW && size > 12) {
          size--;
          ctx.font = `600 ${size}px ${FONT_FAMILY}`;
        }
        ctx.fillText(text, pad, pad + boxH + pad + lineH * (i + 0.5));
      });
    });
  }
}
