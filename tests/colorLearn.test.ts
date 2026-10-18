import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { learnColor } from '../src/tracking/colorLearn';
import { BlobDetector, matchesColor } from '../src/tracking/detector';
import { desaturate, drawDisc, drawRect, drawShadedBall, greyFloorImage, woodImage } from './trackingHelpers';

type RGB = [number, number, number];

const C = CONFIG.camera;
const W = 160;
const H = 120;
/** Lososovo-oranžová loptička z fotky hráča: hore sýtejšia, dole svetlejšia a bledšia; tieň na sivej podlahe. */
const BALL_TOP: RGB = [218, 95, 62];
const BALL_BOTTOM: RGB = [253, 176, 156];
const SHADOW: RGB = [165, 138, 119];
const BALL = { x: 100.3, y: 60.6, r: 8 };

/** Podlaha, tieň vľavo od loptičky a loptička; sat < 1 napodobní bledšie farby kamery Questu. */
function ballScene(seed: number, sat = 1, ball = BALL): Uint8ClampedArray {
  const img = greyFloorImage(W, H, seed);
  drawDisc(img, W, H, ball.x - 0.8 * ball.r, ball.y + 0.2 * ball.r, ball.r, SHADOW);
  drawShadedBall(img, W, H, ball.x, ball.y, ball.r, BALL_TOP, BALL_BOTTOM);
  if (sat !== 1) desaturate(img, sat);
  return img;
}

describe('farba lososovej loptičky', () => {
  it('predvolená oranžová ju nájde aj v bledšom obraze, tieň a podlahu nie', () => {
    expect(matchesColor(...BALL_TOP, C.targets.orange)).toBe(true);
    expect(matchesColor(...BALL_BOTTOM, C.targets.orange)).toBe(true);
    expect(matchesColor(...SHADOW, C.targets.orange)).toBe(false);
    const det = new BlobDetector(W, H);
    expect(det.detect(greyFloorImage(W, H, 7), C.targets.orange, C.detector).found).toBe(false);
    for (const sat of [1, 0.75]) {
      const r = det.detect(ballScene(3, sat), C.targets.orange, C.detector);
      expect(r.found).toBe(true);
      expect(Math.hypot(r.cx - BALL.x, r.cy - BALL.y)).toBeLessThan(0.3 * BALL.r);
    }
  });

  it('po ťuknutí vedľa nej sa naučí jej farbu aj v bledom obraze a nájde ju aj menšiu inde', () => {
    for (const sat of [1, 0.7, 0.5]) {
      const r = learnColor(ballScene(4, sat), W, H, BALL.x + 3, BALL.y - 2, C.detector, C.learn);
      expect(r.ok, r.reason).toBe(true);
      expect(r.hue).toBeGreaterThan(5);
      expect(r.hue).toBeLessThan(22);
      expect(Math.hypot(r.cx - BALL.x, r.cy - BALL.y)).toBeLessThan(0.1 * BALL.r);
      expect(r.coverage).toBeGreaterThan(0.85);
      // Tieň nemá naučenú farbu, inak by ťahal stred puku k sebe.
      const same = new BlobDetector(W, H).detect(ballScene(4, sat), r.profile, C.detector);
      expect(Math.hypot(same.cx - BALL.x, same.cy - BALL.y)).toBeLessThan(0.05 * BALL.r);

      const far = { x: 40.2, y: 30.7, r: 4 };
      const d = new BlobDetector(W, H).detect(ballScene(5, sat, far), r.profile, C.detector);
      expect(d.found).toBe(true);
      expect(Math.hypot(d.cx - far.x, d.cy - far.y)).toBeLessThan(0.25 * far.r);
    }
  });
});

describe('naučenie farby', () => {
  it('červená loptička: rozsah odtieňa prejde cez 0°', () => {
    const img = woodImage(W, H, 6);
    drawShadedBall(img, W, H, 60, 50, 7, [200, 30, 55], [250, 120, 140]);
    const r = learnColor(img, W, H, 61, 49, C.detector, C.learn);
    expect(r.ok, r.reason).toBe(true);
    expect(r.profile.hueMin).toBeGreaterThan(r.profile.hueMax);
    const d = new BlobDetector(W, H).detect(img, r.profile, C.detector);
    expect(Math.hypot(d.cx - 60, d.cy - 50)).toBeLessThan(0.3);
  });

  it('zelený biscuit na dreve', () => {
    const img = woodImage(W, H, 8);
    drawDisc(img, W, H, 30.5, 80.5, 6, [70, 205, 80]);
    const r = learnColor(img, W, H, 33, 79, C.detector, C.learn);
    expect(r.ok, r.reason).toBe(true);
    expect(r.hue).toBeGreaterThan(110);
    expect(r.hue).toBeLessThan(140);
  });

  it('odmietne ťuknutie na podlahu, rozliatu farbu, pás a dva rovnaké puky', () => {
    const floor = learnColor(greyFloorImage(W, H, 9), W, H, 80, 60, C.detector, C.learn);
    expect(floor.ok).toBe(false);
    expect(floor.reason).toMatch(/nie je farebný/);

    const carpet = woodImage(W, H, 10);
    drawRect(carpet, W, 20, 10, 100, 70, [230, 110, 70]);
    expect(learnColor(carpet, W, H, 60, 40, C.detector, C.learn).reason).toMatch(/rozlieva/);

    const tape = woodImage(W, H, 11);
    drawRect(tape, W, 30, 50, 90, 54, [230, 110, 70]);
    expect(learnColor(tape, W, H, 60, 52, C.detector, C.learn).reason).toMatch(/tvar/);

    const twins = ballScene(12);
    drawShadedBall(twins, W, H, 30, 30, 8, BALL_TOP, BALL_BOTTOM);
    const r = learnColor(twins, W, H, BALL.x, BALL.y, C.detector, C.learn);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/podobnú farbu/);
  });
});
