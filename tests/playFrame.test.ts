import { describe, expect, it } from 'vitest';
import { forwardFromQuat, vec3, yawFromQuat } from '../src/core/math';
import { PlayFrame } from '../src/core/playFrame';
import { createHeadSample, type HeadSample } from '../src/core/types';
import { headAt, quatYawPitch } from './helpers';

const DEG = Math.PI / 180;

function forwardInPlay(frame: PlayFrame, head: HeadSample) {
  const f = forwardFromQuat(vec3(), head.qx, head.qy, head.qz, head.qw);
  return frame.toPlayDir(vec3(), f.x, f.y, f.z);
}

describe('yawFromQuat', () => {
  it.each([0, 90, -135, 179])('vráti yaw %i° aj pri sklonení hlavy', (yawDeg) => {
    for (const pitch of [0, -45, -80, 30]) {
      const q = quatYawPitch(yawDeg, pitch);
      const yaw = yawFromQuat(q.x, q.y, q.z, q.w) / DEG;
      expect(yaw).toBeCloseTo(yawDeg, 6);
    }
  });
});

describe('PlayFrame', () => {
  it.each([0, 90, -135])('po vycentrovaní (yaw %i°) smeruje pohľad hlavy na −Z', (yawDeg) => {
    const head = headAt(2, 1.7, -3, yawDeg, 0);
    const frame = new PlayFrame();
    frame.recenter(head);
    const f = forwardInPlay(frame, head);
    expect(f.x).toBeCloseTo(0, 9);
    expect(f.y).toBeCloseTo(0, 9);
    expect(f.z).toBeCloseTo(-1, 9);
    const p = frame.toPlayPoint(vec3(), head.px, head.py, head.pz);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(1.7, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('pri pohľade prudko nadol berie len yaw, nie sklon', () => {
    const head = headAt(0.4, 1.6, 0.2, 30, -80);
    const frame = new PlayFrame();
    frame.recenter(head);
    expect(frame.yaw / DEG).toBeCloseTo(30, 6);
    const f = forwardInPlay(frame, head);
    expect(f.x).toBeCloseTo(0, 6);
    expect(f.z).toBeLessThan(0);
  });

  it('prevod svet → hra → svet je identita', () => {
    const frame = new PlayFrame();
    frame.set(1.3, -0.7, 2.1);
    const p = vec3();
    const w = vec3();
    for (const [x, y, z] of [
      [0, 0, 0],
      [1, 2, 3],
      [-4.5, 0.1, 7.25],
    ] as const) {
      frame.toPlayPoint(p, x, y, z);
      frame.toWorldPoint(w, p.x, p.y, p.z);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
      expect(w.z).toBeCloseTo(z, 9);
    }
  });

  it('stred plochy pred hráčom leží vo svete v smere jeho pohľadu', () => {
    const head = headAt(0, 1.7, 0, 90, 0); // pozerá sa na −X
    const frame = new PlayFrame();
    frame.recenter(head);
    const c = frame.toWorldPoint(vec3(), 0, 0, -0.55);
    expect(c.x).toBeCloseTo(-0.55, 9);
    expect(c.z).toBeCloseTo(0, 9);
  });

  it('nová hlava má predvolene neplatnú pózu', () => {
    expect(createHeadSample().valid).toBe(false);
  });
});
