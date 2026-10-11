/**
 * Výber ďalšej vlny prekážok a pravidlá spravodlivosti.
 *
 * Vlna je prekážka pre telo, prekážka na zemi alebo ich kombinácia (prídu naraz).
 * Kandidát sa porovná s históriou vĺn podľa odhadovaného času príchodu k hráčovi:
 * - úhyb na opačnú stranu najskôr po minLateralSwitchTime,
 * - v kombinácii je medzera na zemi na strane, kam ide telo,
 * - loptička sa medzi vlnami nemusí presúvať rýchlejšie než maxBallShiftSpeed.
 * Ak nevyhovie žiadny kandidát, príde bezpečná vlna: samotná vysoká tyč (zohnutie ide z každej polohy).
 */
import type { Config } from '../config';
import { headWindow, lowBarGap } from './obstacles';
import { Rng } from './rng';
import type { BodyKind, FloorKind } from './types';

export interface WaveSpec {
  body: BodyKind | null;
  /** Bočný blok: −1 vľavo, +1 vpravo. */
  bodySide: number;
  /** Dvojitý blok: stred medzery. */
  bodyGapX: number;
  floor: FloorKind | null;
  /** Nízka tyč: strana, z ktorej vychádza. */
  floorSide: number;
  floorCoverage: number;
  /** Stred a šírka medzery na zemi (pre obe prekážky na zemi). */
  floorGapX: number;
  floorGapW: number;
  /** Odhadovaný herný čas príchodu k hráčovi. */
  arrival: number;
  /** Kde musí byť hlava (x), aby prekonala prekážku pre telo. */
  headLo: number;
  headHi: number;
  /** Bezpečná náhradná vlna. */
  fallback: boolean;
}

export type FairnessRule = 'waveGap' | 'lateralSwitch' | 'comboSide' | 'comboDouble' | 'comboHighSpeed' | 'ballShift';

export function createWave(): WaveSpec {
  return {
    body: null,
    bodySide: 0,
    bodyGapX: 0,
    floor: null,
    floorSide: 0,
    floorCoverage: 0,
    floorGapX: 0,
    floorGapW: 0,
    arrival: 0,
    headLo: -10,
    headHi: 10,
    fallback: false,
  };
}

function copyWave(out: WaveSpec, w: WaveSpec): void {
  out.body = w.body;
  out.bodySide = w.bodySide;
  out.bodyGapX = w.bodyGapX;
  out.floor = w.floor;
  out.floorSide = w.floorSide;
  out.floorCoverage = w.floorCoverage;
  out.floorGapX = w.floorGapX;
  out.floorGapW = w.floorGapW;
  out.arrival = w.arrival;
  out.headLo = w.headLo;
  out.headHi = w.headHi;
  out.fallback = w.fallback;
}

const HISTORY = 4;

export class Spawner {
  /** Posledná vybraná vlna (objekt sa znovu používa). */
  readonly wave = createWave();
  private readonly candidate = createWave();
  private readonly history: WaveSpec[] = [];
  private historyCount = 0;
  private historyHead = 0;
  private readonly window = { lo: 0, hi: 0 };
  private rng: Rng;

  constructor(
    private readonly cfg: Config,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    for (let i = 0; i < HISTORY; i++) this.history.push(createWave());
  }

  get rngState(): number {
    return this.rng.state;
  }

  reset(seed: number): void {
    this.rng = new Rng(seed);
    this.clearHistory();
  }

  /** Po zásahu zmiznú najbližšie prekážky, takže ich história už neplatí. */
  clearHistory(): void {
    this.historyCount = 0;
    this.historyHead = 0;
  }

  /**
   * Ďalšia vlna pre herný čas `time`, úroveň a aktuálnu rýchlosť. Vráti null, ak by vlna prišla
   * príliš skoro po predošlej (spawn sa skúsi v ďalšom kroku).
   */
  next(time: number, level: number, speed: number, floorEnabled: boolean): WaveSpec | null {
    const arrival = time + this.cfg.obstacles.spawnDistance / speed;
    const last = this.recent(0);
    if (last && arrival - last.arrival < this.cfg.fairness.minWaveGapTime) return null;

    for (let attempt = 0; attempt < this.cfg.fairness.maxAttempts; attempt++) {
      this.sample(this.candidate, level, floorEnabled);
      this.candidate.arrival = arrival;
      if (this.violation(this.candidate, level) === null) {
        copyWave(this.wave, this.candidate);
        this.remember(this.wave);
        return this.wave;
      }
    }
    const w = this.wave;
    w.body = 'highBar';
    w.bodySide = 0;
    w.bodyGapX = 0;
    w.floor = null;
    w.arrival = arrival;
    w.headLo = -10;
    w.headHi = 10;
    w.fallback = true;
    this.remember(w);
    return w;
  }

  /** Ktoré pravidlo by kandidát porušil voči histórii (null = vyhovuje). */
  violation(w: WaveSpec, level: number): FairnessRule | null {
    const f = this.cfg.fairness;

    if (w.body && w.floor) {
      if (w.body === 'sideBlock') {
        // Blok vľavo → hráč ide doprava → medzera na zemi v strede alebo vpravo (a naopak).
        if (w.bodySide < 0 && w.floorGapX < -f.comboSideTolerance) return 'comboSide';
        if (w.bodySide > 0 && w.floorGapX > f.comboSideTolerance) return 'comboSide';
      } else if (w.body === 'doubleBlock') {
        if (Math.abs(w.floorGapX - w.bodyGapX) > f.comboDoubleGapTolerance) return 'comboDouble';
      } else if (level >= f.highSpeedLevel && Math.abs(w.floorGapX) > f.highSpeedMaxFloorOffset) {
        return 'comboHighSpeed';
      }
    }

    let floorChecked = false;
    for (let i = 0; i < this.historyCount; i++) {
      const h = this.recent(i)!;
      const dt = w.arrival - h.arrival;
      if (dt < f.minWaveGapTime) return 'waveGap';
      if (w.body && h.body && dt < f.minLateralSwitchTime && (w.headLo > h.headHi || w.headHi < h.headLo)) {
        return 'lateralSwitch';
      }
      if (w.floor && h.floor && !floorChecked) {
        floorChecked = true; // stačí porovnať s poslednou prekážkou na zemi
        if (Math.abs(w.floorGapX - h.floorGapX) > f.maxBallShiftSpeed * dt) return 'ballShift';
      }
    }
    return null;
  }

  /** i-tá najnovšia vlna v histórii (0 = posledná). */
  private recent(i: number): WaveSpec | null {
    if (i >= this.historyCount) return null;
    return this.history[(this.historyHead - 1 - i + HISTORY * 2) % HISTORY]!;
  }

  private remember(w: WaveSpec): void {
    copyWave(this.history[this.historyHead]!, w);
    this.historyHead = (this.historyHead + 1) % HISTORY;
    if (this.historyCount < HISTORY) this.historyCount++;
  }

  private sample(w: WaveSpec, level: number, floorEnabled: boolean): void {
    const unlock = this.cfg.difficulty.unlock;
    const combosOk = floorEnabled && level >= unlock.combos;
    const pCombo = combosOk ? 0.15 + 0.2 * level : 0;
    const pFloor = floorEnabled ? 0.3 : 0;
    const r = this.rng.next();
    const hasBody = r >= pCombo + pFloor || r < pCombo;
    const hasFloor = r < pCombo + pFloor;

    w.fallback = false;
    w.body = hasBody ? this.pickBody(level) : null;
    w.bodySide = 0;
    w.bodyGapX = 0;
    w.headLo = -10;
    w.headHi = 10;
    if (w.body === 'sideBlock') w.bodySide = this.rng.sign();
    if (w.body === 'doubleBlock') {
      const max = this.cfg.obstacles.doubleBlock.gapMaxOffset;
      w.bodyGapX = this.rng.range(-max, max);
    }
    if (w.body) {
      headWindow(w.body, w.bodySide, w.bodyGapX, this.cfg, this.window);
      w.headLo = this.window.lo;
      w.headHi = this.window.hi;
    }

    w.floor = hasFloor ? this.pickFloor(level) : null;
    w.floorSide = 0;
    w.floorCoverage = 0;
    w.floorGapX = 0;
    w.floorGapW = 0;
    if (w.floor === 'lowBar') {
      const c = this.cfg.obstacles.lowBar;
      w.floorSide = this.rng.sign();
      w.floorCoverage = this.rng.range(c.coverageMin, c.coverageMax);
      const gap = lowBarGap(w.floorSide, w.floorCoverage, this.cfg);
      w.floorGapX = gap.gapX;
      w.floorGapW = gap.gapW;
    } else if (w.floor === 'coneGate') {
      const c = this.cfg.obstacles.coneGate;
      w.floorGapX = this.rng.range(-c.gapMaxOffset, c.gapMaxOffset);
      w.floorGapW = c.gapWidth;
    }
  }

  private pickBody(level: number): BodyKind {
    const u = this.cfg.difficulty.unlock;
    const wSide = level >= u.sideBlock ? 1.2 : 0;
    const wDouble = level >= u.doubleBlock ? 0.8 : 0;
    const r = this.rng.next() * (1 + wSide + wDouble);
    if (r < 1) return 'highBar';
    return r < 1 + wSide ? 'sideBlock' : 'doubleBlock';
  }

  private pickFloor(level: number): FloorKind {
    const wCone = level >= this.cfg.difficulty.unlock.coneGate ? 1 : 0;
    return this.rng.next() * (1 + wCone) < 1 ? 'lowBar' : 'coneGate';
  }
}
