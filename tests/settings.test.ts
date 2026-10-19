import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  BEST_KEY,
  MemoryStorage,
  SETTINGS_KEY,
  cycleCountdown,
  cycleDwell,
  defaultSettings,
  loadBest,
  loadSettings,
  sanitizeSettings,
  saveBest,
  saveSettings,
} from '../src/core/settings';
import { TrackingMonitor } from '../src/xr/tracking';

describe('nastavenia', () => {
  it('majú rozumné predvolené hodnoty', () => {
    expect(defaultSettings(CONFIG)).toEqual({
      dwellTime: 1.2,
      pauseSide: 'right',
      pausePosition: 'side',
      difficulty: 'easy',
      dekerSize: 'medium',
      floorObstacles: true,
      headUp: true,
      countdown: 2,
      frameRate: 90,
      eyeHeight: null,
      debug: false,
    });
  });

  it('neplatné hodnoty opravia alebo nahradia predvolenými', () => {
    const s = sanitizeSettings(
      {
        dwellTime: 5,
        pauseSide: 'up',
        pausePosition: 'top',
        difficulty: 'nightmare',
        countdown: 0,
        eyeHeight: 3,
        headUp: 'áno',
      },
      CONFIG,
    );
    expect(s.headUp).toBe(true);
    expect(sanitizeSettings({ headUp: false }, CONFIG).headUp).toBe(false);
    expect(s.dwellTime).toBe(2);
    expect(s.pauseSide).toBe('right');
    expect(s.pausePosition).toBe('top');
    expect(s.difficulty).toBe('easy');
    expect(sanitizeSettings({ difficulty: 'pro' }, CONFIG).difficulty).toBe('pro');
    expect(sanitizeSettings({ difficulty: 'warmup' }, CONFIG).difficulty).toBe('warmup');
    expect(s.countdown).toBe(1);
    expect(s.eyeHeight).toBeNull();
    expect(sanitizeSettings({ dwellTime: 1.13 }, CONFIG).dwellTime).toBe(1.2);
    expect(sanitizeSettings('nonsense', CONFIG)).toEqual(defaultSettings(CONFIG));
  });

  it('sa uložia a načítajú, poškodený JSON nezhodí hru', () => {
    const storage = new MemoryStorage();
    const s = { ...defaultSettings(CONFIG), dwellTime: 1.6, pauseSide: 'left' as const, eyeHeight: 1.74 };
    saveSettings(storage, s);
    expect(loadSettings(storage, CONFIG)).toEqual(s);
    storage.setItem(SETTINGS_KEY, '{nie je json');
    expect(loadSettings(storage, CONFIG)).toEqual(defaultSettings(CONFIG));
  });

  it('dwell sa cyklí 0,8 → … → 2,0 → 0,8 a odpočet 1 → … → 5 → 1', () => {
    const seen = [0.8];
    let v = 0.8;
    for (let i = 0; i < 7; i++) seen.push((v = cycleDwell(v, CONFIG)));
    expect(seen).toEqual([0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 0.8]);
    expect([1, 2, 3, 4, 5].map((c) => cycleCountdown(c, CONFIG))).toEqual([2, 3, 4, 5, 1]);
  });

  it('rekordy sa vedú pre každú obtiažnosť zvlášť', () => {
    const storage = new MemoryStorage();
    const zero = { warmup: 0, easy: 0, medium: 0, hard: 0, pro: 0 };
    expect(loadBest(storage)).toEqual(zero);
    saveBest(storage, { ...zero, easy: 10, medium: 2500, pro: 7 });
    expect(loadBest(storage)).toEqual({ ...zero, easy: 10, medium: 2500, pro: 7 });
    storage.setItem(BEST_KEY, JSON.stringify({ medium: -5, hard: 'x' }));
    expect(loadBest(storage)).toEqual(zero);
    // Staré rekordy z hry so zrýchľovaním (v1) sa nenačítajú.
    storage.setItem('dangleRush.best.v1', JSON.stringify({ medium: 9999 }));
    expect(loadBest(storage)).toEqual(zero);
  });
});

describe('strata trackingu', () => {
  it('krátky výpadok ignoruje, dlhší nahlási raz a potom obnovenie', () => {
    const m = new TrackingMonitor(0.3);
    expect(m.update(0.1, true)).toBeNull();
    expect(m.update(0.2, false)).toBeNull();
    expect(m.update(0.05, true)).toBeNull();
    expect(m.update(0.2, false)).toBeNull();
    expect(m.update(0.11, false)).toBe('lost');
    expect(m.update(0.5, false)).toBeNull();
    expect(m.update(0.01, true)).toBe('restored');
  });
});
