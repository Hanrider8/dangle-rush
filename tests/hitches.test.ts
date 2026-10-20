import { describe, expect, it } from 'vitest';
import { HITCH_EVENT, HITCH_TEXTURE, HitchProbe } from '../src/xr/hitches';

const T = 1000 / 90;

/** Snímky po T ms; `late` = index snímku, ktorý príde neskoro (o `extra` ms). */
function frames(p: HitchProbe, n: number, opts: { late?: number; extra?: number; mark?: number; js?: number } = {}) {
  let now = 0;
  for (let i = 0; i < n; i++) {
    const interval = i === opts.late ? T + (opts.extra ?? 15) : T;
    now += interval;
    p.beginFrame(now, i === 0 ? 0 : interval, T);
    // Snímok pred neskorým: značka a dlhý JS.
    if (opts.late !== undefined && i === opts.late - 1) {
      if (opts.mark) p.mark(opts.mark);
      p.addCamera(2);
      p.endFrame(now, opts.js ?? 1);
    } else {
      p.endFrame(now, 1);
    }
  }
  return now;
}

describe('záseky XR snímok', () => {
  it('bez neskorých snímok nič nezapíše', () => {
    const p = new HitchProbe();
    const now = frames(p, 200);
    expect(p.total).toBe(0);
    expect(p.recent(now)).toBe(0);
  });

  it('neskorý snímok zapíše aj to, čo robil snímok pred ním', () => {
    const p = new HitchProbe();
    const now = frames(p, 100, { late: 50, extra: 20, mark: HITCH_TEXTURE | HITCH_EVENT, js: 9 });
    expect(p.total).toBe(1);
    expect(p.recent(now)).toBe(1);
    expect(p.lastInterval).toBeCloseTo(T + 20, 6);
    expect(p.lastJs).toBe(9);
    expect(p.lastCamera).toBe(2);
    expect(p.lastFlags).toBe(HITCH_TEXTURE | HITCH_EVENT);
    expect(p.maxJs).toBe(9);
  });

  it('mierne oneskorenie a dlhé medzery (Quest menu) nie sú záseky', () => {
    const p = new HitchProbe();
    frames(p, 100, { late: 30, extra: 3 });
    frames(p, 100, { late: 30, extra: 400 });
    expect(p.total).toBe(0);
  });

  it('počet za posledných 10 s', () => {
    const p = new HitchProbe();
    p.beginFrame(1000, 30, T);
    p.beginFrame(5000, 30, T);
    expect(p.recent(5000)).toBe(2);
    expect(p.recent(12000)).toBe(1);
    expect(p.recent(20000)).toBe(0);
    expect(p.total).toBe(2);
  });
});
