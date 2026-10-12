import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BlobDetector } from '../src/tracking/detector';
import { YuvDownscaler, isYuvFormat } from '../src/tracking/yuv';
import { drawDisc, woodImage } from './trackingHelpers';

const W = 640;
const H = 480;
const OUT_W = 160;
const OUT_H = 120;

/** RGBA → I420 (BT.601, plný rozsah), farba spriemerovaná po 2 × 2 ako v kamere. */
function toI420(rgba: Uint8ClampedArray): { data: Uint8Array; planes: { offset: number; stride: number }[] } {
  const cw = W / 2;
  const ch = H / 2;
  const data = new Uint8Array(W * H + 2 * cw * ch);
  const uOff = W * H;
  const vOff = uOff + cw * ch;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = 4 * (y * W + x);
      data[y * W + x] = Math.round(0.299 * rgba[k]! + 0.587 * rgba[k + 1]! + 0.114 * rgba[k + 2]!);
    }
  }
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let u = 0;
      let v = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const k = 4 * ((2 * cy + dy) * W + 2 * cx + dx);
        const r = rgba[k]!;
        const g = rgba[k + 1]!;
        const b = rgba[k + 2]!;
        const yy = 0.299 * r + 0.587 * g + 0.114 * b;
        u += (b - yy) / 1.772 + 128;
        v += (r - yy) / 1.402 + 128;
      }
      data[uOff + cy * cw + cx] = Math.round(u / 4);
      data[vOff + cy * cw + cx] = Math.round(v / 4);
    }
  }
  return { data, planes: [{ offset: 0, stride: W }, { offset: uOff, stride: cw }, { offset: vOff, stride: cw }] };
}

/** I420 → NV12 (U a V prekladané v jednej rovine). */
function toNV12(i420: ReturnType<typeof toI420>) {
  const cw = W / 2;
  const ch = H / 2;
  const data = new Uint8Array(W * H + 2 * cw * ch);
  data.set(i420.data.subarray(0, W * H));
  for (let i = 0; i < cw * ch; i++) {
    data[W * H + 2 * i] = i420.data[i420.planes[1]!.offset + i]!;
    data[W * H + 2 * i + 1] = i420.data[i420.planes[2]!.offset + i]!;
  }
  return { data, planes: [{ offset: 0, stride: W }, { offset: W * H, stride: W }] };
}

describe('zmenšenie snímky z YUV', () => {
  const rgba = woodImage(W, H, 7);
  drawDisc(rgba, W, H, 401.3, 162.7, 24, [70, 205, 80]);
  const i420 = toI420(rgba);

  it('farby sedia s priemerom pôvodného RGB obrazu', () => {
    const out = new Uint8ClampedArray(OUT_W * OUT_H * 4);
    new YuvDownscaler().convert(i420.data, 'I420', i420.planes, W, H, out, OUT_W, OUT_H, true, 'bt470bg');
    let worst = 0;
    for (const [ox, oy] of [[10, 10], [80, 60], [100, 40], [150, 110]] as const) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let y = oy * 4; y < oy * 4 + 4; y++) for (let x = ox * 4; x < ox * 4 + 4; x++) sum += rgba[4 * (y * W + x) + c]!;
        worst = Math.max(worst, Math.abs(out[4 * (oy * OUT_W + ox) + c]! - sum / 16));
      }
    }
    expect(worst).toBeLessThan(14);
  });

  it('na zmenšenom obraze sa biscuit nájde na správnom mieste a NV12 dá to isté', () => {
    const a = new Uint8ClampedArray(OUT_W * OUT_H * 4);
    const b = new Uint8ClampedArray(OUT_W * OUT_H * 4);
    const down = new YuvDownscaler();
    down.convert(i420.data, 'I420', i420.planes, W, H, a, OUT_W, OUT_H, true, 'bt470bg');
    const nv12 = toNV12(i420);
    down.convert(nv12.data, 'NV12', nv12.planes, W, H, b, OUT_W, OUT_H, true, 'bt470bg');
    expect(Array.from(b)).toEqual(Array.from(a));
    const r = new BlobDetector(OUT_W, OUT_H).detect(a, CONFIG.camera.targets.green, CONFIG.camera.detector);
    expect(r.found).toBe(true);
    // Stred v pixeloch kamery: zmenšený obraz × 4.
    expect(Math.hypot(r.cx * 4 - 401.3, r.cy * 4 - 162.7)).toBeLessThan(1.5);
  });

  it('televízny rozsah: Y 126 a neutrálna farba je stredná šedá', () => {
    const data = new Uint8Array(4 * 4 + 2 * 2 * 2).fill(128);
    data.fill(126, 0, 16);
    const out = new Uint8ClampedArray(4);
    const planes = [{ offset: 0, stride: 4 }, { offset: 16, stride: 2 }, { offset: 20, stride: 2 }];
    new YuvDownscaler().convert(data, 'I420', planes, 4, 4, out, 1, 1, false, 'bt709');
    expect(Array.from(out)).toEqual([128, 128, 128, 255]);
  });

  it('pozná formáty, ktoré vie zmenšiť priamo', () => {
    expect(isYuvFormat('I420')).toBe(true);
    expect(isYuvFormat('NV12')).toBe(true);
    expect(isYuvFormat('BGRA')).toBe(false);
    expect(isYuvFormat(null)).toBe(false);
  });
});
