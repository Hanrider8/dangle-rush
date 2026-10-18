/**
 * Stavový automat hry a fixný časový krok.
 *
 * | Stav      | Prechod                                                                 |
 * |-----------|-------------------------------------------------------------------------|
 * | SETUP     | dwell na „Kalibrovať“ → uloží výšku očí → READY (alebo späť, odkiaľ prišiel) |
 * | READY     | Štart → COUNTDOWN                                                       |
 * | COUNTDOWN | po odpočte → PLAYING                                                    |
 * | PLAYING   | Pauza / auto-pauza → PAUSED; posledný život → GAME_OVER                 |
 * | PAUSED    | Pokračovať → COUNTDOWN → PLAYING presne odtiaľ, kde hra stála           |
 * | GAME_OVER | Nová hra → COUNTDOWN                                                    |
 *
 * READY, PAUSED a GAME_OVER majú podpanely: hlavný, nastavenia a vycentrovanie (s odpočtom).
 * Pohľad (dwell) beží v každom stave, simulácia prekážok len v PLAYING.
 */
import { CONFIG, type Config } from '../config';
import { EventQueue } from './events';
import { GazeSystem } from './gaze';
import {
  computeLayout,
  type LayoutContext,
  type LayoutId,
  type PanelLayout,
  type SettingsAnchor,
} from './layout';
import { copyVec, forwardFromQuat, lerpVec, vec3 } from './math';
import { PlayFrame } from './playFrame';
import {
  MemoryStorage,
  cycleCountdown,
  cycleDwell,
  cycleFrameRate,
  loadBest,
  loadSettings,
  nextDifficulty,
  saveBest,
  saveSettings,
  type BestScores,
  type Difficulty,
  type KeyValueStorage,
  type Settings,
} from './settings';
import { GameplaySim } from './sim';
import {
  createHeadSample,
  createPuckSample,
  type AutoPauseReason,
  type ButtonId,
  type GameState,
  type HeadSample,
  type PuckSample,
  type SubPanel,
} from './types';

export interface GameOptions {
  config?: Config;
  storage?: KeyValueStorage;
  /** Seed prvej hry; každá ďalšia hra dostane odvodený seed. */
  seed?: number;
}

export interface GameResult {
  score: number;
  time: number;
  maxCombo: number;
  bodyPassed: number;
  floorPassed: number;
  /** Prvky na zemi, ktorými puk prešiel, a všetky posúdené (len s kamerou, inak 0). */
  floorHits: number;
  floorJudged: number;
  /** Hlava hore: zachytení spoluhráči a všetci, ktorí sa objavili (vypnuté = 0 / 0). */
  signalsSeen: number;
  signalsTotal: number;
  hits: number;
  best: number;
  newBest: boolean;
  difficulty: Difficulty;
}

export type PauseCause = AutoPauseReason | 'button';

function copyPuck(out: PuckSample, p: PuckSample): void {
  out.valid = p.valid;
  out.x = p.x;
  out.z = p.z;
  out.age = p.age;
}

function copyHead(out: HeadSample, h: HeadSample): void {
  out.valid = h.valid;
  out.px = h.px;
  out.py = h.py;
  out.pz = h.pz;
  out.qx = h.qx;
  out.qy = h.qy;
  out.qz = h.qz;
  out.qw = h.qw;
}

export class Game {
  readonly cfg: Config;
  readonly settings: Settings;
  readonly best: BestScores;
  readonly events = new EventQueue();
  readonly playFrame = new PlayFrame();
  readonly gaze: GazeSystem;
  readonly sim: GameplaySim;

  state: GameState;
  sub: SubPanel = 'main';
  pauseCause: PauseCause | null = null;
  /** Aktuálne rozloženie panelov; layoutVersion sa zvýši pri každej zmene. */
  layout: PanelLayout;
  layoutVersion = 0;
  settingsVersion = 0;
  /** Čas v aktuálnom stave (UI čas, beží aj v pauze). */
  stateTime = 0;
  countdownLeft = 0;
  recenterLeft = 0;
  calibrationError = false;
  result: GameResult | null = null;
  /** Interpolácia renderu medzi poslednými dvoma krokmi simulácie (0–1). */
  alpha = 0;

  /** Hlava v hernom priestore na konci posledného snímku. */
  readonly head = vec3(0, CONFIG.head.defaultEyeHeight, 0);
  readonly headFwd = vec3(0, 0, -1);
  headValid = false;
  /** Posledná platná póza hlavy vo svete (reference space). */
  readonly headWorld: HeadSample = createHeadSample();
  /** Plocha je vycentrovaná podľa platnej pózy v tejto session. */
  centered = false;
  /** Puk sleduje kamera (nastavuje modul kamery): v nastaveniach je Kalibrácia puku. */
  puckTracking = false;
  /** Posledný odhad puku z kamery (vstup ako póza hlavy). */
  readonly puck: PuckSample = createPuckSample();

  private readonly storage: KeyValueStorage;
  private seed: number;
  private setupReturn: GameState = 'READY';
  private setupHeight: number;
  private settingsAt: SettingsAnchor = 'front';
  private calibSum = 0;
  private calibCount = 0;
  private acc = 0;
  private headTrailValid = false;
  private readonly prevHead = vec3();
  private readonly stepHead0 = vec3();
  private readonly stepHead1 = vec3();
  private readonly tmp = vec3();
  /** Puk pre jeden fixný krok: vek sa zmenší o čas, ktorý zostáva do konca snímku. */
  private readonly stepPuck: PuckSample = createPuckSample();

  constructor(options: GameOptions = {}) {
    this.cfg = options.config ?? CONFIG;
    this.storage = options.storage ?? new MemoryStorage();
    this.seed = (options.seed ?? 1) >>> 0;
    this.settings = loadSettings(this.storage, this.cfg);
    this.best = loadBest(this.storage);
    this.gaze = new GazeSystem({ ...this.cfg.gaze, dwellTime: this.settings.dwellTime }, this.events);
    this.sim = new GameplaySim(this.cfg, this.events);
    this.sim.eyeHeight = this.eyeHeight;
    this.setupHeight = this.eyeHeight;
    this.state = this.settings.eyeHeight === null ? 'SETUP' : 'READY';
    this.layout = computeLayout('none', this.layoutContext(), this.cfg);
  }

  /** Kalibrovaná výška očí (alebo predvolená, kým kalibrácia neprebehla). */
  get eyeHeight(): number {
    return this.settings.eyeHeight ?? this.cfg.head.defaultEyeHeight;
  }

  /** Nová AR session: plocha sa vycentruje podľa prvej platnej pózy. */
  beginSession(): void {
    this.centered = false;
    this.headTrailValid = false;
    this.acc = 0;
    this.gaze.reset();
    this.relayout();
  }

  /**
   * Jeden snímok: prepočet hlavy a toľko fixných krokov, koľko sa nazbieralo času.
   * `puck` je odhad puku z kamery (bez kamery sa vynechá a prvky na zemi sa neposudzujú).
   */
  update(frameDt: number, headWorld: HeadSample, puck?: PuckSample): void {
    const sim = this.cfg.sim;
    const dt = frameDt > 0 ? Math.min(frameDt, sim.maxFrameDt) : 0;
    this.readHead(headWorld);
    if (puck) copyPuck(this.puck, puck);
    else this.puck.valid = false;
    this.acc += dt;
    let steps = Math.floor(this.acc / sim.fixedDt + 1e-9);
    if (steps > sim.maxStepsPerFrame) {
      steps = sim.maxStepsPerFrame;
      this.acc = steps * sim.fixedDt;
    }
    // Hlava sa medzi snímkami XR interpoluje, aby bol swept test spojitý aj pri viacerých krokoch.
    for (let i = 0; i < steps; i++) {
      lerpVec(this.stepHead0, this.prevHead, this.head, i / steps);
      lerpVec(this.stepHead1, this.prevHead, this.head, (i + 1) / steps);
      copyPuck(this.stepPuck, this.puck);
      this.stepPuck.age = Math.max(0, this.puck.age - (steps - 1 - i) * sim.fixedDt);
      this.step(sim.fixedDt);
    }
    this.acc = Math.max(0, this.acc - steps * sim.fixedDt);
    if (steps > 0) copyVec(this.prevHead, this.head);
    this.alpha = this.acc / sim.fixedDt;
  }

  /** Modul kamery hlási, či sleduje puk (v nastaveniach pribudne Kalibrácia puku). */
  setPuckTracking(on: boolean): void {
    if (this.puckTracking === on) return;
    this.puckTracking = on;
    this.relayout();
  }

  /** Debug overlay (nastavenie sa uloží). */
  toggleDebug(): void {
    this.settings.debug = !this.settings.debug;
    saveSettings(this.storage, this.settings);
    this.settingsVersion++;
  }

  /** Automatická pauza (Quest menu, strata trackingu, reset priestoru, koniec session). */
  autoPause(reason: AutoPauseReason): void {
    if (this.state !== 'PLAYING' && this.state !== 'COUNTDOWN') return;
    this.pauseCause = reason;
    this.setState('PAUSED');
  }

  private step(dt: number): void {
    this.stateTime += dt;
    const activated = this.gaze.step(dt, this.stepHead1, this.headFwd, this.headValid && this.centered);
    if (this.state === 'SETUP') this.accumulateCalibration(activated);
    if (activated !== null) this.onButton(activated);

    switch (this.state) {
      case 'COUNTDOWN':
        this.stepCountdown(dt);
        break;
      case 'PLAYING':
        this.sim.step(dt, this.stepHead0, this.stepHead1, this.stepPuck, this.headFwd);
        if (this.sim.lives <= 0) this.toGameOver();
        break;
      case 'READY':
      case 'PAUSED':
        if (this.sub === 'recenter') this.stepRecenter(dt);
        break;
      default:
        break;
    }
  }

  private onButton(id: ButtonId): void {
    const s = this.settings;
    switch (id) {
      case 'calibrate':
        this.calibrate();
        return;
      case 'start':
      case 'newGame':
        this.newGame();
        this.toCountdown();
        return;
      case 'pause':
        this.pauseCause = 'button';
        this.setState('PAUSED');
        return;
      case 'resume':
        this.toCountdown();
        return;
      case 'recenter':
        this.sub = 'recenter';
        this.recenterLeft = this.cfg.ui.recenterDelay;
        this.events.push('recenterBeep', '', Math.ceil(this.recenterLeft));
        this.relayout();
        return;
      case 'settings':
        this.settingsAt = this.state === 'PAUSED' ? 'pause' : 'front';
        this.sub = 'settings';
        this.relayout();
        return;
      case 'set.back':
        this.sub = 'main';
        this.relayout();
        return;
      case 'set.puck':
        this.sub = 'puck';
        this.relayout();
        return;
      case 'puck.done':
        this.sub = 'settings';
        this.relayout();
        return;
      case 'set.calibrate':
        this.setupReturn = this.state;
        this.setupHeight = this.head.y;
        this.setState('SETUP');
        return;
      case 'set.dwell':
        s.dwellTime = cycleDwell(s.dwellTime, this.cfg);
        this.gaze.dwellTime = s.dwellTime;
        break;
      case 'set.difficulty':
        // Platí od ďalšej novej hry (rekord sa vedie pre obtiažnosť rozohranej hry).
        s.difficulty = nextDifficulty(s.difficulty);
        break;
      case 'set.floor':
        s.floorObstacles = !s.floorObstacles;
        this.sim.floorEnabled = s.floorObstacles;
        break;
      case 'set.headUp':
        s.headUp = !s.headUp;
        this.sim.headUp.setEnabled(s.headUp, this.sim.time);
        break;
      case 'set.pausePos':
        s.pausePosition = s.pausePosition === 'side' ? 'top' : 'side';
        break;
      case 'set.pauseSide':
        s.pauseSide = s.pauseSide === 'right' ? 'left' : 'right';
        break;
      case 'set.countdown':
        s.countdown = cycleCountdown(s.countdown, this.cfg);
        break;
      case 'set.fps':
        s.frameRate = cycleFrameRate(s.frameRate, this.cfg);
        break;
      case 'set.debug':
        s.debug = !s.debug;
        break;
    }
    // Otvorený panel nastavení sa nepresúva; nové polohy sa prejavia pri ďalšom otvorení panelu.
    saveSettings(this.storage, s);
    this.settingsVersion++;
    this.events.push('settingsChanged', id);
  }

  private setState(next: GameState): void {
    this.state = next;
    this.sub = 'main';
    this.stateTime = 0;
    if (next === 'SETUP') this.calibrationError = false;
    this.events.push('state', next);
    this.relayout();
  }

  private newGame(): void {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    const s = this.settings;
    this.sim.reset(this.seed, this.eyeHeight, s.difficulty, s.floorObstacles, s.headUp);
    this.result = null;
  }

  private toCountdown(): void {
    this.countdownLeft = this.settings.countdown;
    this.setState('COUNTDOWN');
    this.events.push('countdownBeep', '', Math.ceil(this.countdownLeft));
  }

  private stepCountdown(dt: number): void {
    const before = Math.ceil(this.countdownLeft - 1e-9);
    this.countdownLeft -= dt;
    if (this.countdownLeft <= 1e-9) {
      this.toPlaying();
      return;
    }
    const now = Math.ceil(this.countdownLeft - 1e-9);
    if (now < before) this.events.push('countdownBeep', '', now);
  }

  private toPlaying(): void {
    this.countdownLeft = 0;
    this.pauseCause = null;
    // Swept test začne od aktuálnej polohy hlavy, nie od polohy pred pauzou.
    this.resetHeadTrail();
    this.setState('PLAYING');
    this.events.push('go');
  }

  private toGameOver(): void {
    const sim = this.sim;
    const score = Math.floor(sim.score);
    const d = sim.difficulty;
    const newBest = score > this.best[d];
    if (newBest) {
      this.best[d] = score;
      saveBest(this.storage, this.best);
    }
    this.result = {
      score,
      time: sim.time,
      maxCombo: sim.maxCombo,
      bodyPassed: sim.bodyPassed,
      floorPassed: sim.floorPassed,
      floorHits: sim.floorHits,
      floorJudged: sim.floorHits + sim.floorMisses,
      signalsSeen: sim.headUp.seen,
      signalsTotal: sim.headUp.seen + sim.headUp.missed,
      hits: sim.hits,
      best: this.best[d],
      newBest,
      difficulty: d,
    };
    this.setState('GAME_OVER');
    this.events.push('gameOver', newBest ? 'best' : '', score);
  }

  private stepRecenter(dt: number): void {
    const before = Math.ceil(this.recenterLeft - 1e-9);
    this.recenterLeft -= dt;
    if (this.recenterLeft > 1e-9) {
      const now = Math.ceil(this.recenterLeft - 1e-9);
      if (now < before) this.events.push('recenterBeep', '', now);
      return;
    }
    this.recenterLeft = 0;
    if (this.headValid) this.recenterFromHead();
    this.sub = 'main';
    this.events.push('recentered');
    // Hráč sa práve pozerá smerom hry, kde sa objaví panel: nič sa nesmie spustiť samo.
    this.gaze.holdOff();
    this.relayout();
  }

  private accumulateCalibration(activated: ButtonId | null): void {
    if (this.headValid && (this.gaze.focusedId === 'calibrate' || activated === 'calibrate')) {
      this.calibSum += this.stepHead1.y;
      this.calibCount++;
    } else if (this.gaze.focusedId === null && activated === null) {
      this.calibSum = 0;
      this.calibCount = 0;
    }
  }

  private calibrate(): void {
    const h = this.calibCount > 0 ? this.calibSum / this.calibCount : this.head.y;
    this.calibSum = 0;
    this.calibCount = 0;
    if (!(h >= this.cfg.head.minEyeHeight && h <= this.cfg.head.maxEyeHeight)) {
      this.calibrationError = true;
      this.events.push('calibrationFailed', '', h);
      return;
    }
    this.calibrationError = false;
    this.settings.eyeHeight = Math.round(h * 1000) / 1000;
    saveSettings(this.storage, this.settings);
    this.settingsVersion++;
    this.sim.eyeHeight = this.settings.eyeHeight;
    this.events.push('calibrated', '', this.settings.eyeHeight);
    // Hráč stojí vzpriamene a pozerá dopredu: dobrá chvíľa aj na vycentrovanie plochy.
    if (this.headValid) this.recenterFromHead();
    const target = this.setupReturn;
    this.setupReturn = 'READY';
    this.setState(target);
  }

  private recenterFromHead(): void {
    this.playFrame.recenter(this.headWorld);
    this.updateHeadFromWorld();
    this.resetHeadTrail();
  }

  private readHead(h: HeadSample): void {
    if (!h.valid) {
      this.headValid = false;
      this.headTrailValid = false;
      return;
    }
    copyHead(this.headWorld, h);
    if (!this.centered) {
      this.centered = true;
      this.playFrame.recenter(h);
      this.updateHeadFromWorld();
      this.setupHeight = this.head.y;
      this.resetHeadTrail();
      this.relayout();
      return;
    }
    this.updateHeadFromWorld();
    if (!this.headTrailValid) this.resetHeadTrail();
  }

  private updateHeadFromWorld(): void {
    const h = this.headWorld;
    this.playFrame.toPlayPoint(this.head, h.px, h.py, h.pz);
    forwardFromQuat(this.tmp, h.qx, h.qy, h.qz, h.qw);
    this.playFrame.toPlayDir(this.headFwd, this.tmp.x, this.tmp.y, this.tmp.z);
    this.headValid = true;
  }

  /** Ďalšie kroky v tomto snímku začnú aj skončia v aktuálnej polohe hlavy. */
  private resetHeadTrail(): void {
    copyVec(this.prevHead, this.head);
    copyVec(this.stepHead0, this.head);
    copyVec(this.stepHead1, this.head);
    this.headTrailValid = true;
  }

  private layoutId(): LayoutId {
    if (!this.centered) return 'none';
    switch (this.state) {
      case 'SETUP':
        return 'setup';
      case 'COUNTDOWN':
        return 'countdown';
      case 'PLAYING':
        return 'playing';
      case 'READY':
        return this.sub === 'main' ? 'ready' : this.sub;
      case 'PAUSED':
        return this.sub === 'main' ? 'paused' : this.sub;
      case 'GAME_OVER':
        return this.sub === 'main' ? 'gameOver' : this.sub;
    }
  }

  private layoutContext(): LayoutContext {
    return {
      eyeHeight: this.eyeHeight,
      setupHeight: this.setupHeight,
      pauseSide: this.settings.pauseSide,
      pausePosition: this.settings.pausePosition,
      puckTracking: this.puckTracking,
    };
  }

  private relayout(): void {
    this.layout = computeLayout(this.layoutId(), this.layoutContext(), this.cfg, this.settingsAt);
    this.gaze.setButtons(this.layout.buttons);
    this.layoutVersion++;
  }
}
