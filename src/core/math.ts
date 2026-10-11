/**
 * Vektorová matematika bez alokácií: funkcie zapisujú do `out`.
 * `vec3()` alokuje, preto ho voláme len pri inicializácii.
 */
import type { Vec3 } from './types';

export const DEG = Math.PI / 180;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function setVec(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copyVec(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function lerpVec(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function lengthOf(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function normalize(out: Vec3, a: Vec3): Vec3 {
  const len = lengthOf(a);
  if (len < 1e-12) return setVec(out, 0, 0, 0);
  return setVec(out, a.x / len, a.y / len, a.z / len);
}

/** Vektorový súčin; `out` môže byť aj `a` alebo `b`. */
export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return setVec(out, x, y, z);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smer pohľadu z kvaterniónu: q · (0, 0, −1). */
export function forwardFromQuat(out: Vec3, qx: number, qy: number, qz: number, qw: number): Vec3 {
  return setVec(
    out,
    -2 * (qx * qz + qw * qy),
    -2 * (qy * qz - qw * qx),
    -(1 - 2 * (qx * qx + qy * qy)),
  );
}

/**
 * Yaw (otočenie okolo zvislej osi) z kvaterniónu, rozklad YXZ ako v three.js.
 * Funguje aj pri pohľade prudko nadol; pri presne zvislom pohľade použije náhradnú vetvu.
 * Smer hry s yaw ψ je vo svete (−sin ψ, 0, −cos ψ).
 */
export function yawFromQuat(qx: number, qy: number, qz: number, qw: number): number {
  const m23 = 2 * (qy * qz - qw * qx);
  if (Math.abs(m23) < 0.9999999) {
    const m13 = 2 * (qx * qz + qw * qy);
    const m33 = 1 - 2 * (qx * qx + qy * qy);
    return Math.atan2(m13, m33);
  }
  const m31 = 2 * (qx * qz - qw * qy);
  const m11 = 1 - 2 * (qy * qy + qz * qz);
  return Math.atan2(-m31, m11);
}
