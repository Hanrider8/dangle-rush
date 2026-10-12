/**
 * Zmenšenie snímky kamery z YUV (I420, NV12) priamo do malého RGBA obrazu.
 *
 * Kamera Questu dáva snímky I420. Prevod celej snímky 1280 × 1280 na RGB cez canvas trval na Queste
 * ~20 ms. Tu sa z každého bloku zdroja zoberú len 4 vzorky jasu a 4 vzorky farby, takže prevod
 * počíta len zmenšený obraz (napr. 320 × 320). Tabuľky stĺpcov sa predpočítajú, convert() nealokuje.
 */
export type YuvFormat = 'I420' | 'I420A' | 'NV12';

export interface PlaneLayout {
  offset: number;
  stride: number;
}

export function isYuvFormat(format: string | null | undefined): format is YuvFormat {
  return format === 'I420' || format === 'I420A' || format === 'NV12';
}

export class YuvDownscaler {
  private srcW = 0;
  private srcH = 0;
  private outW = 0;
  private outH = 0;
  /** Pre každý výstupný stĺpec a riadok dve súradnice vzoriek v zdroji (1/4 a 3/4 bloku). */
  private xs: Int32Array = new Int32Array(0);
  private ys: Int32Array = new Int32Array(0);

  private prepare(srcW: number, srcH: number, outW: number, outH: number): void {
    if (srcW === this.srcW && srcH === this.srcH && outW === this.outW && outH === this.outH) return;
    this.srcW = srcW;
    this.srcH = srcH;
    this.outW = outW;
    this.outH = outH;
    this.xs = YuvDownscaler.samples(srcW, outW);
    this.ys = YuvDownscaler.samples(srcH, outH);
  }

  private static samples(src: number, out: number): Int32Array {
    const s = src / out;
    const a = new Int32Array(2 * out);
    for (let i = 0; i < out; i++) {
      a[2 * i] = Math.min(src - 1, Math.floor((i + 0.25) * s));
      a[2 * i + 1] = Math.min(src - 1, Math.floor((i + 0.75) * s));
    }
    return a;
  }

  /**
   * Zmenší YUV snímku do RGBA `out` (outW × outH).
   * @param planes rozloženie rovín z VideoFrame.copyTo (Y, U, V alebo Y, UV pri NV12)
   * @param fullRange true = Y 0–255; false = televízny rozsah 16–235
   * @param matrix 'bt709', inak BT.601 (bt470bg, smpte170m)
   */
  convert(
    data: Uint8Array,
    format: YuvFormat,
    planes: readonly PlaneLayout[],
    srcW: number,
    srcH: number,
    out: Uint8ClampedArray,
    outW: number,
    outH: number,
    fullRange: boolean,
    matrix: string,
  ): void {
    this.prepare(srcW, srcH, outW, outH);
    const kr = matrix === 'bt709' ? 0.2126 : 0.299;
    const kb = matrix === 'bt709' ? 0.0722 : 0.114;
    const kg = 1 - kr - kb;
    const rv = 2 * (1 - kr);
    const bu = 2 * (1 - kb);
    const gu = (2 * kb * (1 - kb)) / kg;
    const gv = (2 * kr * (1 - kr)) / kg;
    const yScale = fullRange ? 1 : 255 / 219;
    const yOff = fullRange ? 0 : 16;
    const cScale = fullRange ? 1 : 255 / 224;

    const yp = planes[0]!;
    const up = planes[1]!;
    const vp = format === 'NV12' ? planes[1]! : planes[2]!;
    // NV12: U a V sú prekladané v jednej rovine (U na párnom, V na nepárnom bajte).
    const cStep = format === 'NV12' ? 2 : 1;
    const vShift = format === 'NV12' ? 1 : 0;
    const xs = this.xs;
    const ys = this.ys;
    let k = 0;
    for (let oy = 0; oy < outH; oy++) {
      const ya = ys[2 * oy]!;
      const yb = ys[2 * oy + 1]!;
      const rowYa = yp.offset + ya * yp.stride;
      const rowYb = yp.offset + yb * yp.stride;
      const rowUa = up.offset + (ya >> 1) * up.stride;
      const rowUb = up.offset + (yb >> 1) * up.stride;
      const rowVa = vp.offset + (ya >> 1) * vp.stride + vShift;
      const rowVb = vp.offset + (yb >> 1) * vp.stride + vShift;
      for (let ox = 0; ox < outW; ox++) {
        const xa = xs[2 * ox]!;
        const xb = xs[2 * ox + 1]!;
        const ca = (xa >> 1) * cStep;
        const cb = (xb >> 1) * cStep;
        const y = (data[rowYa + xa]! + data[rowYa + xb]! + data[rowYb + xa]! + data[rowYb + xb]!) * 0.25;
        const u = (data[rowUa + ca]! + data[rowUa + cb]! + data[rowUb + ca]! + data[rowUb + cb]!) * 0.25 - 128;
        const v = (data[rowVa + ca]! + data[rowVa + cb]! + data[rowVb + ca]! + data[rowVb + cb]!) * 0.25 - 128;
        const Y = (y - yOff) * yScale;
        const U = u * cScale;
        const V = v * cScale;
        out[k] = Y + rv * V;
        out[k + 1] = Y - gu * U - gv * V;
        out[k + 2] = Y + bu * U;
        out[k + 3] = 255;
        k += 4;
      }
    }
  }
}
