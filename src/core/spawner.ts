/**
 * Výber ďalšej vlny prekážok a pravidlá spravodlivosti.
 *
 * Hra trénuje hlavne miesanie puku: väčšina vĺn sú prekážky na zemi (brána, nízka tyč, slalom,
 * hviezdy, široké miesanie, pohyblivá hokejka), obranca príde len občas (spawn.bodyShare*).
 * Od strednej obtiažnosti môže obranca prísť spolu s bránou alebo tyčou na zemi.
 *
 * Kandidát sa porovná s históriou vĺn podľa odhadovaného času príchodu k hráčovi:
 * - medzi koncom predošlej vlny a začiatkom ďalšej je aspoň minWaveGapTime,
 * - úhyb tela na opačnú stranu najskôr po minLateralSwitchTime,
 * - v kombinácii je medzera na zemi na strane, kam ide telo,
 * - puk sa medzi vlnami nemusí presúvať rýchlejšie než maxPuckShiftSpeed
 *   (vnútri vzorov to zaručuje ich konštrukcia).
 * Ak nevyhovie žiadny kandidát, príde bezpečná brána tam, kde je puk po predošlej vlne.
 */
import type { Config } from '../config';
import { lerp } from './math';
import { MAX_ELEMENTS, headWindow, lowBarGap } from './obstacles';
import { Rng } from './rng';
import type { BodyKind, FloorKind } from './types';

export interface WaveSpec {
  body: BodyKind | null;
  /** Bočný blok: −1 vľavo, +1 vpravo. */
  bodySide: number;
  /** Dvojitý blok: stred medzery. */
  bodyGapX: number;
  floor: FloorKind | null;
  /**
   * Strana pri prekážke na zemi: nízka tyč – odkiaľ vychádza; slalom a široké miesanie – kde ide
   * puk pri prvom prvku; pohyblivá hokejka – kde bude medzera na konci.
   */
  floorSide: number;
  /** Nízka tyč a pohyblivá hokejka: aká časť šírky plochy je zakrytá. */
  floorCoverage: number;
  /** Brána: stred; slalom: os kužeľov. */
  floorCenterX: number;
  /** Počet prvkov vzoru (1 pre jednoduché prekážky). */
  floorCount: number;
  /** Hviezdy: polohy v x. */
  readonly floorXs: Float64Array;
  /** Čas medzi prvkami vzoru. */
  floorElementTime: number;
  /** Kadiaľ ide puk pri prvom a poslednom prvku. */
  firstPuckX: number;
  lastPuckX: number;
  /** Odhadovaný herný čas príchodu prvého a posledného prvku k hráčovi. */
  arrival: number;
  arrivalEnd: number;
  /** Kde musí byť hlava (x), aby prekonala obrancu. */
  headLo: number;
  headHi: number;
  /** Bezpečná náhradná vlna. */
  fallback: boolean;
}

export type FairnessRule =
  | 'waveGap'
  | 'lateralSwitch'
  | 'comboSide'
  | 'comboDouble'
  | 'comboHighSpeed'
  | 'puckShift';

const BODY_KINDS: readonly BodyKind[] = ['highBar', 'sideBlock', 'doubleBlock'];
const FLOOR_KINDS: readonly FloorKind[] = ['lowBar', 'coneGate', 'slalom', 'stars', 'wideDangle', 'pokeCheck'];
/** Prekážky na zemi, ktoré môžu prísť spolu s obrancom. */
const COMBO_FLOOR_KINDS: readonly FloorKind[] = ['lowBar', 'coneGate'];

export function createWave(): WaveSpec {
  return {
    body: null,
    bodySide: 0,
    bodyGapX: 0,
    floor: null,
    floorSide: 0,
    floorCoverage: 0,
    floorCenterX: 0,
    floorCount: 0,
    floorXs: new Float64Array(MAX_ELEMENTS),
    floorElementTime: 0,
    firstPuckX: 0,
    lastPuckX: 0,
    arrival: 0,
    arrivalEnd: 0,
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
  out.floorCenterX = w.floorCenterX;
  out.floorCount = w.floorCount;
  out.floorXs.set(w.floorXs);
  out.floorElementTime = w.floorElementTime;
  out.firstPuckX = w.firstPuckX;
  out.lastPuckX = w.lastPuckX;
  out.arrival = w.arrival;
  out.arrivalEnd = w.arrivalEnd;
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
    if (last && arrival - last.arrivalEnd < this.cfg.fairness.minWaveGapTime) return null;

    const c = this.candidate;
    for (let attempt = 0; attempt < this.cfg.fairness.maxAttempts; attempt++) {
      this.sample(c, level, floorEnabled);
      c.arrival = arrival;
      c.arrivalEnd = arrival + (c.floorCount > 1 ? (c.floorCount - 1) * c.floorElementTime : 0);
      if (this.violation(c, level) === null) {
        copyWave(this.wave, c);
        this.remember(this.wave);
        return this.wave;
      }
    }
    if (!floorEnabled) return null;
    // Bezpečná vlna: brána tam, kde je puk po poslednej prekážke na zemi.
    const w = this.wave;
    this.clearFloor(w);
    this.clearBody(w);
    const max = this.cfg.obstacles.coneGate.gapMaxOffset;
    const x = Math.max(-max, Math.min(max, this.lastFloorPuckX()));
    w.floor = 'coneGate';
    w.floorCount = 1;
    w.floorCenterX = x;
    w.firstPuckX = x;
    w.lastPuckX = x;
    w.arrival = arrival;
    w.arrivalEnd = arrival;
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
        if (w.bodySide < 0 && w.firstPuckX < -f.comboSideTolerance) return 'comboSide';
        if (w.bodySide > 0 && w.firstPuckX > f.comboSideTolerance) return 'comboSide';
      } else if (w.body === 'doubleBlock') {
        if (Math.abs(w.firstPuckX - w.bodyGapX) > f.comboDoubleGapTolerance) return 'comboDouble';
      } else if (level >= f.highSpeedLevel && Math.abs(w.firstPuckX) > f.highSpeedMaxFloorOffset) {
        return 'comboHighSpeed';
      }
    }

    let floorChecked = false;
    for (let i = 0; i < this.historyCount; i++) {
      const h = this.recent(i)!;
      const dt = w.arrival - h.arrivalEnd;
      if (dt < f.minWaveGapTime) return 'waveGap';
      if (w.body && h.body && dt < f.minLateralSwitchTime && (w.headLo > h.headHi || w.headHi < h.headLo)) {
        return 'lateralSwitch';
      }
      if (w.floor && h.floor && !floorChecked) {
        floorChecked = true; // stačí porovnať s poslednou prekážkou na zemi
        if (Math.abs(w.firstPuckX - h.lastPuckX) > f.maxPuckShiftSpeed * dt) return 'puckShift';
      }
    }
    return null;
  }

  /** i-tá najnovšia vlna v histórii (0 = posledná). */
  private recent(i: number): WaveSpec | null {
    if (i >= this.historyCount) return null;
    return this.history[(this.historyHead - 1 - i + HISTORY * 2) % HISTORY]!;
  }

  private lastFloorPuckX(): number {
    for (let i = 0; i < this.historyCount; i++) {
      const h = this.recent(i)!;
      if (h.floor) return h.lastPuckX;
    }
    return 0;
  }

  private remember(w: WaveSpec): void {
    copyWave(this.history[this.historyHead]!, w);
    this.historyHead = (this.historyHead + 1) % HISTORY;
    if (this.historyCount < HISTORY) this.historyCount++;
  }

  private sample(w: WaveSpec, level: number, floorEnabled: boolean): void {
    const s = this.cfg.spawn;
    const bodyOk = this.weightOf(BODY_KINDS, level, s.bodyWeights) > 0;
    let hasBody: boolean;
    let hasFloor: boolean;
    if (!floorEnabled) {
      hasBody = true;
      hasFloor = false;
    } else {
      hasBody = bodyOk && this.rng.next() < lerp(s.bodyShareMin, s.bodyShareMax, level);
      hasFloor = !hasBody || (level >= this.cfg.difficulty.unlock.combos && this.rng.next() < s.comboShare);
    }
    w.fallback = false;
    this.clearBody(w);
    if (hasBody) this.sampleBody(w, level);
    this.clearFloor(w);
    if (hasFloor) this.sampleFloor(w, level, hasBody ? COMBO_FLOOR_KINDS : FLOOR_KINDS);
  }

  private sampleBody(w: WaveSpec, level: number): void {
    const kind = this.pick(BODY_KINDS, level, this.cfg.spawn.bodyWeights) ?? 'sideBlock';
    w.body = kind;
    if (kind === 'sideBlock') w.bodySide = this.rng.sign();
    if (kind === 'doubleBlock') {
      const max = this.cfg.obstacles.doubleBlock.gapMaxOffset;
      w.bodyGapX = this.rng.range(-max, max);
    }
    headWindow(kind, w.bodySide, w.bodyGapX, this.cfg, this.window);
    w.headLo = this.window.lo;
    w.headHi = this.window.hi;
  }

  private sampleFloor(w: WaveSpec, level: number, kinds: readonly FloorKind[]): void {
    const o = this.cfg.obstacles;
    const kind = this.pick(kinds, level, this.cfg.spawn.floorWeights) ?? 'coneGate';
    w.floor = kind;
    w.floorCount = 1;
    switch (kind) {
      case 'lowBar': {
        w.floorSide = this.rng.sign();
        w.floorCoverage = this.rng.range(o.lowBar.coverageMin, o.lowBar.coverageMax);
        const gap = lowBarGap(w.floorSide, w.floorCoverage, this.cfg);
        w.firstPuckX = w.lastPuckX = gap.gapX;
        return;
      }
      case 'coneGate':
        w.floorCenterX = this.rng.range(-o.coneGate.gapMaxOffset, o.coneGate.gapMaxOffset);
        w.firstPuckX = w.lastPuckX = w.floorCenterX;
        return;
      case 'slalom': {
        const c = o.slalom;
        w.floorCount = c.minCones + Math.floor(this.rng.next() * (c.maxCones - c.minCones + 1));
        w.floorCenterX = this.rng.range(-c.centerMaxOffset, c.centerMaxOffset);
        w.floorSide = this.rng.sign();
        w.floorElementTime = c.coneTime;
        const lastSide = (w.floorCount - 1) % 2 === 0 ? w.floorSide : -w.floorSide;
        w.firstPuckX = w.floorCenterX + w.floorSide * c.passOffset;
        w.lastPuckX = w.floorCenterX + lastSide * c.passOffset;
        return;
      }
      case 'stars': {
        const c = o.stars;
        w.floorCount = c.minStars + Math.floor(this.rng.next() * (c.maxStars - c.minStars + 1));
        w.floorElementTime = c.starTime;
        // Náhodná prechádzka: susedné hviezdy sú dosiahnuteľné pri maxPuckShiftSpeed.
        const step = 0.9 * this.cfg.fairness.maxPuckShiftSpeed * c.starTime;
        let x = this.rng.range(-c.maxOffset, c.maxOffset);
        for (let i = 0; i < w.floorCount; i++) {
          if (i > 0) x = Math.max(-c.maxOffset, Math.min(c.maxOffset, x + this.rng.range(-step, step)));
          w.floorXs[i] = x;
        }
        w.firstPuckX = w.floorXs[0]!;
        w.lastPuckX = w.floorXs[w.floorCount - 1]!;
        return;
      }
      case 'wideDangle': {
        const c = o.wideDangle;
        w.floorCount = 2;
        w.floorSide = this.rng.sign();
        w.floorElementTime = c.gateTime;
        w.firstPuckX = w.floorSide * c.offset;
        w.lastPuckX = -w.floorSide * c.offset;
        return;
      }
      case 'pokeCheck': {
        const c = o.pokeCheck;
        w.floorSide = this.rng.sign();
        w.floorCoverage = this.rng.range(c.coverageMin, c.coverageMax);
        w.firstPuckX = w.lastPuckX = (w.floorSide * w.floorCoverage * this.cfg.playArea.width) / 2;
        return;
      }
    }
  }

  private clearBody(w: WaveSpec): void {
    w.body = null;
    w.bodySide = 0;
    w.bodyGapX = 0;
    w.headLo = -10;
    w.headHi = 10;
  }

  private clearFloor(w: WaveSpec): void {
    w.floor = null;
    w.floorSide = 0;
    w.floorCoverage = 0;
    w.floorCenterX = 0;
    w.floorCount = 0;
    w.floorElementTime = 0;
    w.firstPuckX = 0;
    w.lastPuckX = 0;
  }

  /** Súčet váh odomknutých typov. */
  private weightOf<K extends BodyKind | FloorKind>(
    kinds: readonly K[],
    level: number,
    weights: Record<K, number>,
  ): number {
    const unlock = this.cfg.difficulty.unlock;
    let total = 0;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i]!;
      if (level >= unlock[k]) total += weights[k];
    }
    return total;
  }

  /** Vážený náhodný výber spomedzi odomknutých typov (null, ak nie je žiadny). */
  private pick<K extends BodyKind | FloorKind>(
    kinds: readonly K[],
    level: number,
    weights: Record<K, number>,
  ): K | null {
    const total = this.weightOf(kinds, level, weights);
    if (total <= 0) return null;
    const unlock = this.cfg.difficulty.unlock;
    let r = this.rng.next() * total;
    let lastValid: K | null = null;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i]!;
      if (level < unlock[k] || weights[k] <= 0) continue;
      lastValid = k;
      r -= weights[k];
      if (r < 0) return k;
    }
    return lastValid;
  }
}
