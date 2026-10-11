/** Pomocné funkcie pre testy sledovania puku: kvaternióny, pohyb hlavy, syntetické obrazy. */
import { Rng } from '../src/core/rng';
import type { Pose } from '../src/tracking/poseHistory';

const DEG = Math.PI / 180;

type Q = { x: number; y: number; z: number; w: number };

function axisAngle(ax: number, ay: number, az: number, deg: number): Q {
  const h = (deg * DEG) / 2;
  const s = Math.sin(h);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
}

function mul(a: Q, b: Q): Q {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Orientácia hlavy: yaw (okolo +Y, + doľava), sklon (okolo +X, + hore), náklon (okolo −Z). */
export function quatYPR(yawDeg: number, pitchDeg: number, rollDeg = 0): Q {
  return mul(mul(axisAngle(0, 1, 0, yawDeg), axisAngle(1, 0, 0, pitchDeg)), axisAngle(0, 0, 1, rollDeg));
}

export function poseAt(px: number, py: number, pz: number, q: Q, out: Pose): Pose {
  out.px = px;
  out.py = py;
  out.pz = pz;
  out.qx = q.x;
  out.qy = q.y;
  out.qz = q.z;
  out.qw = q.w;
  return out;
}

/** Yaw a sklon (stupne) smeru z bodu p do bodu t. */
export function aimAngles(p: { x: number; y: number; z: number }, t: { x: number; y: number; z: number }) {
  const dx = t.x - p.x;
  const dy = t.y - p.y;
  const dz = t.z - p.z;
  return { yaw: Math.atan2(-dx, -dz) / DEG, pitch: Math.atan2(dy, Math.hypot(dx, dz)) / DEG };
}

/**
 * Hlava sa pozerá okolo cieľa na podlahe: bod pohľadu krúži okolo neho (± spanX do strán,
 * ± spanZ bližšie a ďalej), hlava sa pritom mierne nakláňa a hýbe. span = 0 znamená nehybnú hlavu.
 */
export function circlingHead(
  target: { x: number; y: number; z: number },
  base: { x: number; y: number; z: number },
  spanX = 0.45,
  spanZ = 0.35,
) {
  const moving = spanX > 0 || spanZ > 0 ? 1 : 0;
  return (tMs: number, out: Pose): Pose => {
    const s = tMs / 1000;
    const head = {
      x: base.x + moving * 0.04 * Math.sin(2 * Math.PI * 0.3 * s),
      y: base.y + moving * 0.02 * Math.sin(2 * Math.PI * 0.4 * s),
      z: base.z + moving * 0.03 * Math.sin(2 * Math.PI * 0.25 * s),
    };
    const gaze = {
      x: target.x + spanX * Math.sin(2 * Math.PI * 0.35 * s),
      y: target.y,
      z: target.z + spanZ * Math.sin(2 * Math.PI * 0.5 * s + 0.7),
    };
    const aim = aimAngles(head, gaze);
    return poseAt(head.x, head.y, head.z, quatYPR(aim.yaw, aim.pitch, moving * 3 * Math.sin(2 * Math.PI * 0.27 * s)), out);
  };
}

/** Normálne rozdelené číslo (Box–Muller) zo seedovaného Rng. */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-12, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

/** RGBA obraz „svetlé drevo“: béžová so žilkami a šumom. */
export function woodImage(w: number, h: number, seed = 1): Uint8ClampedArray {
  const rng = new Rng(seed);
  const img = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const grain = 14 * Math.sin(x * 0.21 + Math.sin(y * 0.05) * 3) + (x % 37 < 2 ? -22 : 0);
      const k = 4 * (y * w + x);
      const n = () => (rng.next() - 0.5) * 20;
      img[k] = 205 + grain + n();
      img[k + 1] = 165 + grain * 0.8 + n();
      img[k + 2] = 115 + grain * 0.6 + n();
      img[k + 3] = 255;
    }
  }
  return img;
}

/** Nakreslí vyplnený kruh s vyhladeným okrajom (podvzorkovanie 4 × 4). */
export function drawDisc(
  img: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  rgb: [number, number, number],
): void {
  for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(h, Math.ceil(cy + r + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(w, Math.ceil(cx + r + 1)); x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) cover++;
        }
      }
      if (cover === 0) continue;
      const a = cover / 16;
      const k = 4 * (y * w + x);
      for (let c = 0; c < 3; c++) img[k + c] = img[k + c]! * (1 - a) + rgb[c]! * a;
    }
  }
}

/** Vyplnený obdĺžnik (napr. pás pásky). */
export function drawRect(
  img: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = 4 * (y * w + x);
      img[k] = rgb[0];
      img[k + 1] = rgb[1];
      img[k + 2] = rgb[2];
    }
  }
}
