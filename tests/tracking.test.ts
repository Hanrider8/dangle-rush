import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { CameraModel, cameraSideFromLabel, guessParams, rotateVec, scaleParams } from '../src/tracking/cameraModel';
import { BlobDetector, matchesColor } from '../src/tracking/detector';
import { PoseHistory, createPose } from '../src/tracking/poseHistory';
import { TimeSync } from '../src/tracking/timeSync';
import { drawDisc, drawRect, poseAt, quatYPR, woodImage } from './trackingHelpers';

const C = CONFIG.camera;
const GREEN: [number, number, number] = [70, 205, 80];
const ORANGE: [number, number, number] = [245, 120, 30];

describe('história pózy', () => {
  it('interpoluje polohu aj orientáciu medzi snímkami', () => {
    const h = new PoseHistory(16);
    const p = createPose();
    const a = quatYPR(0, 0);
    const b = quatYPR(20, 0);
    h.push(100, 0, 1.5, 0, a.x, a.y, a.z, a.w);
    h.push(110, 0.1, 1.5, 0, b.x, b.y, b.z, b.w);
    expect(h.sample(105, p)).toBe(true);
    expect(p.px).toBeCloseTo(0.05, 9);
    const mid = quatYPR(10, 0);
    expect(Math.abs(p.qx * mid.x + p.qy * mid.y + p.qz * mid.z + p.qw * mid.w)).toBeCloseTo(1, 4);
  });

  it('nevráti pózu mimo histórie ani v medzere trackingu', () => {
    const h = new PoseHistory(16, 50);
    const p = createPose();
    h.push(100, 0, 0, 0, 0, 0, 0, 1);
    h.push(110, 0, 0, 0, 0, 0, 0, 1);
    h.push(300, 0, 0, 0, 0, 0, 0, 1);
    expect(h.sample(90, p)).toBe(false);
    expect(h.sample(200, p)).toBe(false);
    expect(h.sample(310, p)).toBe(true);
    expect(h.sample(400, p)).toBe(false);
  });

  it('kruhový buffer zabudne najstaršie pózy a export ide od najstaršej', () => {
    const h = new PoseHistory(4);
    for (let i = 0; i < 10; i++) h.push(i * 10, i, 0, 0, 0, 0, 0, 1);
    expect(h.size).toBe(4);
    expect(h.oldestTime).toBe(60);
    expect(h.newestTime).toBe(90);
    const { times, data } = h.exportRange(65, 90);
    expect(Array.from(times)).toEqual([70, 80, 90]);
    expect(data[0]).toBe(7);
    const copy = PoseHistory.fromArrays(times, data);
    const p = createPose();
    expect(copy.sample(75, p)).toBe(true);
    expect(p.px).toBeCloseTo(7.5, 9);
  });
});

describe('časové značky kamery', () => {
  it('odstráni jitter príchodu: čas snímky = značka + najmenší posun', () => {
    const sync = new TimeSync(30);
    const base = 5000;
    let maxErr = 0;
    for (let i = 0; i < 60; i++) {
      const capture = base + i * 33.3;
      const jitter = (i * 7919) % 13; // 0–12 ms
      const t = sync.map(capture * 1000 + 123_456_000, capture + 40 + jitter);
      if (i >= 30) maxErr = Math.max(maxErr, Math.abs(t - (capture + 40)));
    }
    expect(sync.usingTimestamps).toBe(true);
    expect(maxErr).toBeLessThan(1.5);
    expect(sync.meanExtraDelay).toBeGreaterThan(3);
  });

  it('bez platnej značky použije čas príchodu a po skoku začne odznova', () => {
    const sync = new TimeSync(10);
    expect(sync.map(0, 1234)).toBe(1234);
    expect(sync.usingTimestamps).toBe(false);
    sync.map(1_000_000, 1050);
    sync.map(1_033_000, 1083);
    expect(sync.map(10_000, 1116)).toBeCloseTo(1116, 6);
    expect(sync.resets).toBe(1);
  });
});

describe('model kamery', () => {
  const params = { ...guessParams(1280, 960, 80, C.guess.offset, 1, 50), rx: -0.12, ry: 0.04, rz: 0.02 };
  const cam = new CameraModel(params);
  const head = poseAt(0.2, 1.5, -0.1, quatYPR(15, -55, 4), createPose());

  it('premietnutie a lúč na podlahu sú navzájom inverzné', () => {
    const px = { u: 0, v: 0 };
    const hit = { x: 0, y: 0, z: 0 };
    for (const [x, z] of [
      [0.1, -0.9],
      [0.5, -1.2],
      [-0.2, -0.7],
    ] as const) {
      expect(cam.project(head, x, 0.015, z, px)).toBe(true);
      expect(cam.pixelToPlane(head, px.u, px.v, 0.015, hit)).toBe(true);
      expect(hit.x).toBeCloseTo(x, 9);
      expect(hit.z).toBeCloseTo(z, 9);
    }
  });

  it('obraz má v nadol a u doprava; bod za kamerou sa nepremietne', () => {
    const level = poseAt(0, 1.5, 0, quatYPR(0, 0), createPose());
    const straight = new CameraModel(guessParams(1280, 960, 80, { x: 0, y: 0, z: 0 }, 1, 0));
    const px = { u: 0, v: 0 };
    expect(straight.project(level, 0, 1.5, -2, px)).toBe(true);
    expect(px.u).toBeCloseTo(640, 6);
    expect(px.v).toBeCloseTo(480, 6);
    straight.project(level, 0.3, 1.2, -2, px);
    expect(px.u).toBeGreaterThan(640);
    expect(px.v).toBeGreaterThan(480);
    expect(straight.project(level, 0, 1.5, 2, px)).toBe(false);
  });

  it('pixel nad horizontom podlahu nepretne a záber na podlahe siaha od spodného okraja po horizont', () => {
    const level = poseAt(0, 1.5, 0, quatYPR(0, -30), createPose());
    const straight = new CameraModel(guessParams(1280, 960, 80, { x: 0, y: 0, z: 0 }, 1, 0));
    const hit = { x: 0, y: 0, z: 0 };
    expect(straight.pixelToPlane(level, 640, 0, 0, hit)).toBe(false);
    expect(straight.pixelToPlane(level, 640, 480, 0, hit)).toBe(true);
    expect(hit.z).toBeCloseTo(-1.5 / Math.tan((30 * Math.PI) / 180), 6);
    const pts = new Float32Array(64);
    expect(straight.footprint(level, 0, 6, 8, pts)).toBe(32);
    const zs = Array.from({ length: 32 }, (_, i) => pts[2 * i + 1]!);
    // Horný okraj je nad horizontom (skráti sa na 6 m), spodný okraj je bližšie ako stred obrazu.
    expect(Math.min(...zs)).toBeLessThan(-6 + 1e-3);
    expect(Math.max(...zs)).toBeGreaterThan(hit.z);
    const vHalf = Math.atan(480 / straight.params.f);
    expect(Math.max(...zs)).toBeCloseTo(-1.5 / Math.tan((30 * Math.PI) / 180 + vHalf), 5);
  });

  it('zmena rozlíšenia zachová lúče', () => {
    const half = new CameraModel(scaleParams(params, 640, 480));
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    cam.direction(head, 900, 300, a);
    half.direction(head, 450, 150, b);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });

  it('strana kamery podľa názvu zariadenia v Quest Browseri', () => {
    expect(cameraSideFromLabel('camera 1, facing back')).toBe(-1);
    expect(cameraSideFromLabel('camera 2, facing back')).toBe(1);
    expect(cameraSideFromLabel('camera 2 1, facing back')).toBe(-1);
    expect(cameraSideFromLabel('camera 2 2, facing back')).toBe(1);
    expect(cameraSideFromLabel('camera 0, facing front')).toBe(0);
    expect(cameraSideFromLabel('FaceTime HD Camera')).toBe(0);
  });

  it('rotateVec otočí vektor rovnako ako kvaternión yaw 90°', () => {
    const q = quatYPR(90, 0);
    const out = rotateVec(q.x, q.y, q.z, q.w, 0, 0, -1, { x: 0, y: 0, z: 0 });
    expect(out.x).toBeCloseTo(-1, 9);
    expect(out.z).toBeCloseTo(0, 9);
  });
});

describe('detektor farebného puku', () => {
  const W = 160;
  const H = 120;
  const limits = C.detector;

  it('drevo nie je zelené ani oranžové, biscuit a loptička áno', () => {
    expect(matchesColor(205, 165, 115, C.targets.green)).toBe(false);
    expect(matchesColor(205, 165, 115, C.targets.orange)).toBe(false);
    expect(matchesColor(220, 150, 95, C.targets.orange)).toBe(false);
    expect(matchesColor(...GREEN, C.targets.green)).toBe(true);
    expect(matchesColor(...ORANGE, C.targets.orange)).toBe(true);
    expect(matchesColor(40, 110, 50, C.targets.green)).toBe(true);
  });

  it('nájde zelený biscuit na dreve s presnosťou pod 0,3 px', () => {
    const img = woodImage(W, H);
    drawDisc(img, W, H, 101.3, 40.7, 6, GREEN);
    const det = new BlobDetector(W, H);
    const r = det.detect(img, C.targets.green, limits);
    expect(r.found).toBe(true);
    expect(r.cx).toBeCloseTo(101.3, 0);
    expect(Math.hypot(r.cx - 101.3, r.cy - 40.7)).toBeLessThan(0.3);
    expect(r.area).toBeGreaterThan(90);
  });

  it('nájde aj oranžovú loptičku a na samotnom dreve nenájde nič', () => {
    const det = new BlobDetector(W, H);
    expect(det.detect(woodImage(W, H, 2), C.targets.orange, limits).found).toBe(false);
    expect(det.detect(woodImage(W, H, 3), C.targets.green, limits).found).toBe(false);
    const img = woodImage(W, H, 4);
    drawDisc(img, W, H, 30.2, 90.6, 4.5, ORANGE);
    const r = det.detect(img, C.targets.orange, limits);
    expect(r.found).toBe(true);
    expect(Math.hypot(r.cx - 30.2, r.cy - 90.6)).toBeLessThan(0.3);
  });

  it('pretiahnutý pás a obrovská plocha nie sú puk; vyberie sa najväčšia rozumná škvrna', () => {
    const img = woodImage(W, H, 5);
    drawRect(img, W, 10, 10, 13, 60, GREEN); // páska
    drawRect(img, W, 60, 70, 160, 120, GREEN); // veľká zelená plocha (rastlina, koberec)
    drawDisc(img, W, H, 40, 30, 3, GREEN); // malý šum
    drawDisc(img, W, H, 120, 30, 5, GREEN); // biscuit
    const det = new BlobDetector(W, H);
    const r = det.detect(img, C.targets.green, limits);
    expect(r.found).toBe(true);
    expect(Math.hypot(r.cx - 120, r.cy - 30)).toBeLessThan(0.3);
    expect(r.candidates).toBe(2);
  });
});
