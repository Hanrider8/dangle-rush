/**
 * Model kamery headsetu: dierková komora (pinhole) pevne spojená s hlavou.
 *
 * Súradnice kamery sú ako v hlave a vo WebXR: +x doprava, +y hore, kamera sa pozerá po −z.
 * Pixely: u doprava, v nadol; obraz pokrýva ⟨0, width⟩ × ⟨0, height⟩ (stred pixelu je i + 0,5).
 * Puk leží na podlahe, preto stačí jedna kamera: lúč z pixelu sa pretne s vodorovnou rovinou
 * vo výške stredu puku.
 */
import type { Vec3 } from '../core/types';
import type { Pose } from './poseHistory';

export interface CamParams {
  /** Rozmery obrazu, ku ktorým patria f, cx a cy (px). */
  width: number;
  height: number;
  /** Ohnisková vzdialenosť a stred obrazu (px). */
  f: number;
  cx: number;
  cy: number;
  /** Natočenie kamery voči hlave ako rotačný vektor (os × uhol, rad). */
  rx: number;
  ry: number;
  rz: number;
  /** Poloha kamery voči hlave (m). */
  tx: number;
  ty: number;
  tz: number;
  /** Snímka s časom t zodpovedá póze hlavy v čase t − latencyMs. */
  latencyMs: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pixel {
  u: number;
  v: number;
}

/** Odhad kamery pred kalibráciou: stred obrazu v strede, kamera rovnobežne s pohľadom. */
export function guessParams(
  width: number,
  height: number,
  hfovDeg: number,
  offset: { x: number; y: number; z: number },
  side: -1 | 0 | 1,
  latencyMs: number,
): CamParams {
  return {
    width,
    height,
    f: width / 2 / Math.tan((hfovDeg * Math.PI) / 360),
    cx: width / 2,
    cy: height / 2,
    rx: 0,
    ry: 0,
    rz: 0,
    tx: side * Math.abs(offset.x),
    ty: offset.y,
    tz: offset.z,
    latencyMs,
  };
}

/**
 * Strana kamery podľa názvu zariadenia v Quest Browseri: „camera 1, facing back“ je ľavá,
 * „camera 2, facing back“ pravá (staršie verzie: „camera 2 1“, „camera 2 2“). Inak 0 (nevedno).
 */
export function cameraSideFromLabel(label: string): -1 | 0 | 1 {
  const m = /(\d+)\s*,\s*facing back/i.exec(label);
  if (!m) return 0;
  return m[1] === '1' ? -1 : m[1] === '2' ? 1 : 0;
}

/** Prepočet na iné rozlíšenie toho istého záberu (rovnaký výrez, iná mierka). */
export function scaleParams(p: CamParams, width: number, height: number): CamParams {
  const sx = width / p.width;
  const sy = height / p.height;
  return { ...p, width, height, f: p.f * sx, cx: p.cx * sx, cy: p.cy * sy };
}

/** Kvaternión z rotačného vektora. */
export function quatFromRotVec(rx: number, ry: number, rz: number, out: Quat): Quat {
  const angle = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (angle < 1e-12) {
    out.x = rx / 2;
    out.y = ry / 2;
    out.z = rz / 2;
    out.w = 1;
    return out;
  }
  const s = Math.sin(angle / 2) / angle;
  out.x = rx * s;
  out.y = ry * s;
  out.z = rz * s;
  out.w = Math.cos(angle / 2);
  return out;
}

/** Otočí vektor (x, y, z) kvaterniónom (qx, qy, qz, qw); `out` môže byť ľubovoľný Vec3. */
export function rotateVec(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  x: number,
  y: number,
  z: number,
  out: Vec3,
): Vec3 {
  // v' = v + w·t + q × t, kde t = 2 (q × v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out.x = x + qw * tx + (qy * tz - qz * ty);
  out.y = y + qw * ty + (qz * tx - qx * tz);
  out.z = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** Kamera s parametrami a predpočítaným natočením; metódy nealokujú. */
export class CameraModel {
  params: CamParams;
  private readonly q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private readonly a: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly b: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(params: CamParams) {
    this.params = params;
    this.setParams(params);
  }

  setParams(p: CamParams): void {
    this.params = p;
    quatFromRotVec(p.rx, p.ry, p.rz, this.q);
  }

  /** Poloha kamery vo svete pre danú pózu hlavy. */
  origin(head: Pose, out: Vec3): Vec3 {
    const p = this.params;
    rotateVec(head.qx, head.qy, head.qz, head.qw, p.tx, p.ty, p.tz, out);
    out.x += head.px;
    out.y += head.py;
    out.z += head.pz;
    return out;
  }

  /** Jednotkový smer lúča z pixelu vo svete. */
  direction(head: Pose, u: number, v: number, out: Vec3): Vec3 {
    const p = this.params;
    const q = this.q;
    rotateVec(q.x, q.y, q.z, q.w, (u - p.cx) / p.f, -(v - p.cy) / p.f, -1, this.a);
    rotateVec(head.qx, head.qy, head.qz, head.qw, this.a.x, this.a.y, this.a.z, out);
    const len = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
    out.x /= len;
    out.y /= len;
    out.z /= len;
    return out;
  }

  /**
   * Bod na vodorovnej rovine y = planeY, kam ukazuje pixel. False, ak lúč rovinu pred kamerou
   * nepretne (pixel nad horizontom).
   */
  pixelToPlane(head: Pose, u: number, v: number, planeY: number, out: Vec3): boolean {
    const o = this.origin(head, this.b);
    const d = this.direction(head, u, v, out);
    if (d.y > -1e-6) return false;
    const s = (planeY - o.y) / d.y;
    if (!(s > 0)) return false;
    out.x = o.x + d.x * s;
    out.y = planeY;
    out.z = o.z + d.z * s;
    return true;
  }

  /** Premietne bod sveta do obrazu. False, ak je bod za kamerou. */
  project(head: Pose, x: number, y: number, z: number, out: Pixel): boolean {
    const p = this.params;
    const q = this.q;
    const o = this.origin(head, this.b);
    // Do súradníc hlavy (inverzná rotácia = konjugovaný kvaternión), potom do kamery.
    rotateVec(-head.qx, -head.qy, -head.qz, head.qw, x - o.x, y - o.y, z - o.z, this.a);
    const c = rotateVec(-q.x, -q.y, -q.z, q.w, this.a.x, this.a.y, this.a.z, this.a);
    if (c.z > -1e-6) return false;
    out.u = p.cx + (p.f * c.x) / -c.z;
    out.v = p.cy - (p.f * c.y) / -c.z;
    return true;
  }

  /**
   * Čo kamera vidí na podlahe: body okraja obrazu premietnuté na rovinu (x, z dvojice do `out`).
   * Lúč nad horizontom alebo ďalej ako maxDist sa skráti na maxDist vo vodorovnom smere.
   * Vráti počet bodov (4 × perEdge).
   */
  footprint(head: Pose, planeY: number, maxDist: number, perEdge: number, out: Float32Array): number {
    const { width: w, height: h } = this.params;
    const o = this.origin(head, this.b);
    let k = 0;
    for (let edge = 0; edge < 4; edge++) {
      for (let i = 0; i < perEdge; i++) {
        const s = i / perEdge;
        const u = edge === 0 ? s * w : edge === 1 ? w : edge === 2 ? (1 - s) * w : 0;
        const v = edge === 0 ? 0 : edge === 1 ? s * h : edge === 2 ? h : (1 - s) * h;
        const d = this.direction(head, u, v, this.a);
        const hx = d.x;
        const hz = d.z;
        const hLen = Math.sqrt(hx * hx + hz * hz) || 1;
        let dist = maxDist;
        if (d.y < -1e-6) {
          const t = (planeY - o.y) / d.y;
          if (t > 0) dist = Math.min(maxDist, t * hLen);
        }
        out[k++] = o.x + (hx / hLen) * dist;
        out[k++] = o.z + (hz / hLen) * dist;
      }
    }
    return 4 * perEdge;
  }
}
