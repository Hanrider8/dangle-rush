import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { pointAabbDistSq, segmentAabbDistSq, sweptHeadHit } from '../src/core/collision';
import {
  Obstacle,
  makeDoubleBlock,
  makeHighBar,
  makeSideBlock,
} from '../src/core/obstacles';
import type { Vec3 } from '../src/core/types';

const H = 1.7;
const R = CONFIG.head.radius;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Prekážka prejde celou dráhou okolo statickej hlavy po krokoch dĺžky `step` metrov. */
function passes(o: Obstacle, head: Vec3, step = 0.02): boolean {
  for (let z = -3; z < 2; z += step) {
    o.prevZ = z;
    o.z = z + step;
    if (sweptHeadHit(o, head, head, R)) return true;
  }
  return false;
}

/** Diskrétny test (len v koncových polohách), na porovnanie so swept testom. */
function discreteHit(o: Obstacle, head: Vec3): boolean {
  const b = o.boxes;
  for (let i = 0; i < o.boxCount; i++) {
    const k = i * 6;
    const d = pointAabbDistSq(head.x, head.y, head.z - o.z, b[k]!, b[k + 1]!, b[k + 2]!, b[k + 3]!, b[k + 4]!, b[k + 5]!);
    if (d <= R * R) return true;
  }
  return false;
}

describe('vzdialenosť úsečky od kvádra', () => {
  it('je presná aj pri prechode cez kváder a pri minutí', () => {
    expect(segmentAabbDistSq(-2, 0, 0, 2, 0, 0, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5)).toBe(0);
    expect(Math.sqrt(segmentAabbDistSq(-2, 1, 0, 2, 1, 0, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5))).toBeCloseTo(0.5, 9);
    // Šikmo popri rohu (priamka x + y = 2): najbližší bod je vnútri úsečky, nie na jej konci.
    const d = Math.sqrt(segmentAabbDistSq(-1, 3, 0, 3, -1, 0, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5));
    expect(d).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('vysoká tyč', () => {
  const o = new Obstacle();
  makeHighBar(o, H, CONFIG);
  const bottom = CONFIG.obstacles.highBar.heightRatio * H;

  it('vzpriamená hlava narazí, zohnutá prejde', () => {
    expect(passes(o, v(0, H, 0))).toBe(true);
    expect(passes(o, v(0, bottom - R - 0.05, 0))).toBe(false);
  });

  it('hranica je presne spodná hrana mínus polomer hlavy', () => {
    expect(passes(o, v(0, bottom - R - 0.001, 0))).toBe(false);
    expect(passes(o, v(0, bottom - R + 0.001, 0))).toBe(true);
  });

  it('nedá sa obísť úkrokom ani preskočiť', () => {
    expect(passes(o, v(1.2, H, 0))).toBe(true);
    expect(passes(o, v(0, 2.3, 0))).toBe(true);
  });
});

describe('bočný blok', () => {
  const inner = CONFIG.obstacles.sideBlock.innerX;

  it('blok vľavo: v strede zásah, po úkroku doprava prejde', () => {
    const o = new Obstacle();
    makeSideBlock(o, -1, H, CONFIG);
    expect(passes(o, v(0, H * 0.9, 0))).toBe(true);
    expect(passes(o, v(inner + R + 0.001, H * 0.9, 0))).toBe(false);
    expect(passes(o, v(inner + R - 0.001, H * 0.9, 0))).toBe(true);
  });

  it('blok vpravo: zrkadlovo', () => {
    const o = new Obstacle();
    makeSideBlock(o, 1, H, CONFIG);
    expect(passes(o, v(0, H * 0.9, 0))).toBe(true);
    expect(passes(o, v(-(inner + R + 0.001), H * 0.9, 0))).toBe(false);
  });

  it('nedá sa obísť zohnutím ani vystretím', () => {
    const o = new Obstacle();
    makeSideBlock(o, -1, H, CONFIG);
    expect(passes(o, v(0, 0.6, 0))).toBe(true);
    expect(passes(o, v(0, H + 0.05, 0))).toBe(true);
  });
});

describe('dvojitý blok', () => {
  it('hlava musí prejsť medzerou', () => {
    const o = new Obstacle();
    makeDoubleBlock(o, 0.1, H, CONFIG);
    const half = CONFIG.obstacles.doubleBlock.gapWidth / 2 - R;
    expect(passes(o, v(0.1, H * 0.9, 0))).toBe(false);
    expect(passes(o, v(0.1 + half - 0.002, H * 0.9, 0))).toBe(false);
    expect(passes(o, v(0.1 + half + 0.002, H * 0.9, 0))).toBe(true);
    expect(passes(o, v(-0.3, H * 0.9, 0))).toBe(true);
  });
});

describe('swept test', () => {
  it('zachytí rýchlu prekážku pri veľkom kroku, ktorú diskrétny test minie', () => {
    const o = new Obstacle();
    makeHighBar(o, H, CONFIG);
    // 5 m/s a krok 0,1 s: tyč preskočí z 0,25 m pred hlavou na 0,25 m za hlavu.
    o.prevZ = -0.25;
    o.z = 0.25;
    const head = v(0, H, 0);
    expect(discreteHit(o, head)).toBe(false);
    o.z = -0.25;
    expect(discreteHit(o, head)).toBe(false);
    o.z = 0.25;
    expect(sweptHeadHit(o, head, head, R)).toBe(true);
  });

  it('zachytí aj rýchly pohyb hlavy cez stojacu prekážku', () => {
    const o = new Obstacle();
    makeSideBlock(o, -1, H, CONFIG);
    o.prevZ = o.z = 0;
    expect(sweptHeadHit(o, v(0.6, 1.5, 0), v(-1.6, 1.5, 0), R)).toBe(true);
    expect(sweptHeadHit(o, v(0.6, 1.5, 0), v(0.6, 1.5, 0.5), R)).toBe(false);
  });

  it('tesné minutie o 1 mm nie je zásah ani pri spojitom prechode', () => {
    const o = new Obstacle();
    makeSideBlock(o, 1, H, CONFIG);
    const x = -(CONFIG.obstacles.sideBlock.innerX + R + 0.001);
    expect(passes(o, v(x, 1.5, 0), 0.4)).toBe(false);
    expect(passes(o, v(x + 0.002, 1.5, 0), 0.4)).toBe(true);
  });
});
