import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { MemoryStorage, SETTINGS_KEY, cycleFrameRate, loadSettings } from '../src/core/settings';
import { FrameRateControl, pickFrameRate } from '../src/xr/frameRate';

describe('obnovovacia frekvencia', () => {
  it('vyberie najvyššiu podporovanú, ktorá nepresahuje želanú', () => {
    const quest3 = [72, 80, 90, 120];
    expect(pickFrameRate(quest3, 120)).toBe(120);
    expect(pickFrameRate(quest3, 90)).toBe(90);
    expect(pickFrameRate([72, 90], 120)).toBe(90);
    expect(pickFrameRate([90, 120], 72)).toBe(90);
  });

  it('nastavenie sa cyklí 72 → 90 → 120 a neplatná hodnota sa nahradí predvolenou', () => {
    expect(cycleFrameRate(72, CONFIG)).toBe(90);
    expect(cycleFrameRate(120, CONFIG)).toBe(72);
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ frameRate: 144 }));
    expect(loadSettings(storage, CONFIG).frameRate).toBe(CONFIG.render.targetFrameRate);
    storage.setItem(SETTINGS_KEY, JSON.stringify({ frameRate: 90 }));
    expect(loadSettings(storage, CONFIG).frameRate).toBe(90);
  });

  it('frekvenciu žiada počas snímkov, kým ju session nehlási; nedokončený pokus zopakuje', async () => {
    const calls: number[] = [];
    let settle: (() => void) | null = null;
    const session = {
      frameRate: 72,
      supportedFrameRates: new Float32Array([72, 80, 90, 120]),
      updateTargetFrameRate(rate: number) {
        calls.push(rate);
        return new Promise<void>((resolve) => {
          settle = resolve;
        });
      },
    } as unknown as XRSession;
    const ctl = new FrameRateControl(120);
    ctl.onFrame(session, 0);
    ctl.onFrame(session, 100);
    expect(calls).toEqual([120]);
    // Prvý pokus sa nikdy nedokončí: po 3 s skúsi znova.
    ctl.onFrame(session, 3200);
    expect(calls).toEqual([120, 120]);
    (session as unknown as { frameRate: number }).frameRate = 120;
    (settle as unknown as () => void)();
    await Promise.resolve();
    ctl.onFrame(session, 6000);
    expect(calls.length).toBe(2);
    expect(ctl.current).toBe(120);
    expect(ctl.describe()).toContain('beží 120 Hz');
  });

  it('keď hra frekvenciu nestíha, zníži ju o stupeň (120 → 90) a pri stabilných snímkach už nie', () => {
    const calls: number[] = [];
    const session = {
      frameRate: 120,
      supportedFrameRates: new Float32Array([72, 80, 90, 120]),
      updateTargetFrameRate(rate: number) {
        calls.push(rate);
        (session as unknown as { frameRate: number }).frameRate = rate;
        return Promise.resolve();
      },
    } as unknown as XRSession;
    const ctl = new FrameRateControl(120);
    let t = 0;
    // 5 s stabilne: bez zmeny.
    for (let i = 0; i < 600; i++) ctl.onFrame(session, (t += 1000 / 120));
    expect(calls).toEqual([]);
    // Každý 10. snímok vynechaný (10 % neskoro): ústup na 90 Hz.
    for (let i = 0; i < 600 && calls.length === 0; i++) ctl.onFrame(session, (t += i % 10 === 9 ? 2000 / 120 : 1000 / 120));
    expect(calls).toEqual([90]);
    expect(ctl.cap).toBe(90);
    expect(ctl.autoNote()).toContain('120');
    // Na 90 Hz stabilne: ostane, aj keď je v nastaveniach 120.
    for (let i = 0; i < 900; i++) ctl.onFrame(session, (t += 1000 / 90));
    expect(calls).toEqual([90]);
    expect(ctl.current).toBe(90);
    // Nová session alebo zmena nastavenia strop zruší.
    ctl.reset(120);
    expect(ctl.cap).toBe(Infinity);
  });

  it('dlhé medzery (Quest menu) a jednotlivé záseky frekvenciu neznížia, pod 72 Hz sa nejde', () => {
    const calls: number[] = [];
    const session = {
      frameRate: 72,
      supportedFrameRates: new Float32Array([60, 72, 90]),
      updateTargetFrameRate(rate: number) {
        calls.push(rate);
        return Promise.resolve();
      },
    } as unknown as XRSession;
    const ctl = new FrameRateControl(72);
    let t = 0;
    for (let i = 0; i < 2000; i++) ctl.onFrame(session, (t += i % 200 === 199 ? 900 : i % 100 === 50 ? 40 : 1000 / 72));
    expect(calls).toEqual([]);
    // Aj keď 72 Hz nestíha, na 60 Hz automaticky nezíde.
    for (let i = 0; i < 2000; i++) ctl.onFrame(session, (t += i % 4 === 0 ? 2000 / 72 : 1000 / 72));
    expect(calls).toEqual([]);
  });
});
