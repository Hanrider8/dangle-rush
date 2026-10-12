import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Rng } from '../src/core/rng';
import { calibrateStatic } from '../src/tracking/calibration';
import { CameraModel, guessParams, type CamParams } from '../src/tracking/cameraModel';
import { PoseHistory, createPose, type Pose } from '../src/tracking/poseHistory';
import { circlingHead, gauss, poseAt, quatYPR } from './trackingHelpers';

const C = CONFIG.camera;
const W = 1280;
const H = 960;
const PLANE = C.targets.green.centerHeight;
const DEG = Math.PI / 180;

/**
 * Skutočná kamera v teste: iná ohnisková vzdialenosť a sklon ako odhad z configu, posunutý stred,
 * oneskorenie 45 ms.
 */
const TRUE: CamParams = {
  width: W,
  height: H,
  f: 800,
  cx: 652,
  cy: 468,
  rx: -0.05,
  ry: 0.035,
  rz: 0.015,
  tx: 0.034,
  ty: -0.016,
  tz: -0.074,
  latencyMs: 45,
};

const GUESS = guessParams(W, H, C.guess.hfovDeg, C.guess.offset, 1, C.guess.latencyMs, C.guess.pitchDeg);

interface Scenario {
  poses: PoseHistory;
  t: number[];
  u: number[];
  v: number[];
}

/**
 * Hlava krúži nad pukom 8 s (pózy 90 Hz), kamera sníma 30 Hz so šumom 0,6 px.
 * target(tMs) vráti polohu puku v čase zachytenia (nehybný alebo hýbajúci sa).
 */
function simulate(
  head: (tMs: number, out: Pose) => Pose,
  target: (tMs: number) => { x: number; z: number },
  seed = 11,
  durationMs = 8000,
): Scenario {
  const rng = new Rng(seed);
  const poses = new PoseHistory(2000);
  const pose = createPose();
  for (let t = 0; t <= durationMs; t += 1000 / 90) poses.pushPose(t, head(t, pose));
  const cam = new CameraModel(TRUE);
  const px = { u: 0, v: 0 };
  const s: Scenario = { poses, t: [], u: [], v: [] };
  for (let capture = 400; capture <= durationMs - TRUE.latencyMs; capture += 1000 / 30) {
    const p = target(capture);
    if (!cam.project(head(capture, pose), p.x, PLANE, p.z, px)) continue;
    if (px.u < 0 || px.u > W || px.v < 0 || px.v > H) continue;
    s.t.push(capture + TRUE.latencyMs);
    s.u.push(px.u + 0.6 * gauss(rng));
    s.v.push(px.v + 0.6 * gauss(rng));
  }
  return s;
}

/** Najväčší uhol medzi lúčmi dvoch kamier cez mriežku pixelov (rovnaká póza hlavy). */
function maxRayErrorDeg(a: CamParams, b: CamParams): number {
  const head = poseAt(0, 1.5, 0, quatYPR(0, -50), createPose());
  const ca = new CameraModel(a);
  const cb = new CameraModel(b);
  const da = { x: 0, y: 0, z: 0 };
  const db = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (let u = 0.2; u <= 0.8; u += 0.1) {
    for (let v = 0.2; v <= 0.8; v += 0.1) {
      ca.direction(head, u * W, v * H, da);
      cb.direction(head, u * W, v * H, db);
      const c = Math.min(1, da.x * db.x + da.y * db.y + da.z * db.z);
      worst = Math.max(worst, Math.acos(c) / DEG);
    }
  }
  return worst;
}

const BALL = { x: 0.1, z: -0.8 };
const HEAD_BASE = { x: 0, y: 1.5, z: 0 };
const AIM = { x: BALL.x, y: PLANE, z: BALL.z };

describe('samokalibrácia kamery z nehybného puku', () => {
  it('z odhadu nájde ohnisko, natočenie, oneskorenie aj polohu puku', () => {
    const s = simulate(circlingHead(AIM, HEAD_BASE), () => BALL);
    const r = calibrateStatic(s.t, s.u, s.v, s.poses, GUESS, PLANE, C.calibration);
    expect(r.reason).toBe('');
    expect(r.ok).toBe(true);
    expect(r.rmsDeg).toBeLessThan(0.08);
    expect(Math.abs(r.params.f - TRUE.f) / TRUE.f).toBeLessThan(0.02);
    expect(Math.abs(r.params.latencyMs - TRUE.latencyMs)).toBeLessThan(5);
    expect(Math.hypot(r.targetX - BALL.x, r.targetZ - BALL.z)).toBeLessThan(0.015);
    expect(maxRayErrorDeg(r.params, TRUE)).toBeLessThan(0.4);
    // Odhad pred kalibráciou bol citeľne vedľa.
    expect(maxRayErrorDeg(GUESS, TRUE)).toBeGreaterThan(5);
  });

  it('po kalibrácii premietne puk na podlahu s chybou pod 2 cm aj pri inej póze hlavy', () => {
    const s = simulate(circlingHead(AIM, HEAD_BASE), () => BALL);
    const r = calibrateStatic(s.t, s.u, s.v, s.poses, GUESS, PLANE, C.calibration);
    const truth = new CameraModel(TRUE);
    const est = new CameraModel(r.params);
    const head = poseAt(0.15, 1.42, 0.05, quatYPR(-20, -48, 2), createPose());
    const px = { u: 0, v: 0 };
    const hit = { x: 0, y: 0, z: 0 };
    for (const [x, z] of [
      [0.3, -0.9],
      [-0.4, -1.1],
      [0.6, -0.6],
    ] as const) {
      expect(truth.project(head, x, PLANE, z, px)).toBe(true);
      expect(est.pixelToPlane(head, px.u, px.v, PLANE, hit)).toBe(true);
      expect(Math.hypot(hit.x - x, hit.z - z)).toBeLessThan(0.02);
    }
  });

  it('neprijme kalibráciu, keď sa puk hýbe', () => {
    const s = simulate(circlingHead(AIM, HEAD_BASE), (t) => ({
      x: BALL.x + 0.25 * Math.sin(t / 300),
      z: BALL.z + 0.1 * Math.cos(t / 450),
    }));
    const r = calibrateStatic(s.t, s.u, s.v, s.poses, GUESS, PLANE, C.calibration);
    expect(r.ok).toBe(false);
  });

  it('bez pohybu hlavy nemá z čoho kalibrovať', () => {
    const s = simulate(circlingHead(AIM, HEAD_BASE, 0, 0), () => BALL);
    const r = calibrateStatic(s.t, s.u, s.v, s.poses, GUESS, PLANE, C.calibration);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('krúž hlavou');
  });

  it('s málo pozorovaniami skončí hneď', () => {
    const s = simulate(circlingHead(AIM, HEAD_BASE), () => BALL, 3, 1500);
    const r = calibrateStatic(s.t, s.u, s.v, s.poses, GUESS, PLANE, C.calibration);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('málo pozorovaní');
  });
});
