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
});
