/**
 * Zapojenie vrstiev: XR session → póza hlavy → hra (core) → udalosti (audio, efekty) → render a UI.
 * V hernej slučke sa nič nealokuje: póza, udalosti aj meshe sú predalokované.
 */
import type { Object3D, WebGLRenderer } from 'three';
import { Sfx } from './audio/sfx';
import { CONFIG } from './config';
import type { GameEvent } from './core/events';
import { Game } from './core/game';
import type { KeyValueStorage } from './core/settings';
import { MAX_ELEMENTS } from './core/obstacles';
import { createHeadSample, createPuckSample, type PuckSample } from './core/types';
import { HitVignette } from './render/effects';
import { FloorFeedback } from './render/feedback';
import { Darkening, TeammateView } from './render/headUp';
import { createResources } from './render/materials';
import { ObstacleViews } from './render/obstacleViews';
import { PlayAreaView } from './render/playArea';
import { createRenderer } from './render/renderer';
import { applyPlayFrame, createScene, type SceneRig } from './render/scene';
import { UiManager } from './ui/panels';
import { FrameRateControl } from './xr/frameRate';
import { readHeadPose } from './xr/headPose';
import { InputGuard } from './xr/inputGuard';
import { startArSession } from './xr/session';
import { TrackingMonitor } from './xr/tracking';

export class App {
  readonly renderer: WebGLRenderer;
  readonly rig: SceneRig;
  readonly game: Game;
  readonly ui: UiManager;
  readonly obstacles: ObstacleViews;
  readonly feedback: FloorFeedback;
  /** Hlava hore: spoluhráč nad horizontom a zatmavenie, kým sa naňho hráč nepozrie. */
  readonly teammate: TeammateView;
  readonly darkening = new Darkening(CONFIG);
  readonly playArea = new PlayAreaView();
  readonly vignette = new HitVignette();
  readonly sfx = new Sfx(CONFIG.audio.volume);
  readonly head = createHeadSample();
  /** Puk pre hru: vyplní ho puckSource (kamera, v emulátore autopilot), inak je neplatný. */
  readonly puck = createPuckSample();
  puckSource: ((nowMs: number, out: PuckSample) => void) | null = null;
  readonly tracking = new TrackingMonitor(CONFIG.tracking.lostGrace);
  readonly inputGuard = new InputGuard();
  /** Obnovovacia frekvencia XR podľa nastavení (žiada sa počas snímkov). */
  readonly frameRate: FrameRateControl;
  session: XRSession | null = null;
  onSessionEnd: (() => void) | null = null;
  /** Len pre vývoj: simulácia straty trackingu (IWER ju nevie emulovať). */
  simulateTrackingLoss = false;
  /** Len pre vývoj: záznam udalostí pre skriptované testy. */
  devLog: string[] | null = null;
  /**
   * Rozšírenia (napr. test kamery `?cam=1`): volajú sa v každom XR snímku po hernej logike a pred
   * renderom, s časom snímku (ms) a dt (s). Póza hlavy z tohto snímku je v `head`.
   */
  readonly frameHooks: ((time: number, dt: number) => void)[] = [];
  private lastTime = -1;

  constructor(container: HTMLElement, storage: KeyValueStorage) {
    this.renderer = createRenderer(container);
    this.rig = createScene();
    this.game = new Game({ storage, seed: Date.now() & 0x7fffffff });
    this.frameRate = new FrameRateControl(this.game.settings.frameRate);
    this.rig.playRoot.add(this.playArea.root);
    const resources = createResources();
    this.obstacles = new ObstacleViews(resources, CONFIG);
    this.rig.playRoot.add(this.obstacles.root);
    this.feedback = new FloorFeedback(resources, CONFIG);
    this.rig.playRoot.add(this.feedback.root);
    this.teammate = new TeammateView(resources);
    this.rig.playRoot.add(this.teammate.root);
    this.rig.scene.add(this.darkening.mesh);
    this.rig.scene.add(this.vignette.mesh);
    this.ui = new UiManager(CONFIG, this.rig.playRoot, this.rig.scene);
    this.precompile();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.game.autoPause('visibility');
    });
    window.addEventListener('resize', this.onResize);
    // Na desktope (emulátor) prepína debug overlay kláves ` alebo F2.
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === 'F2') this.game.toggleDebug();
    });
  }

  /**
   * Skompiluje shadery všetkých materiálov vopred (aj skrytých prekážok, efektov a zatmavenia).
   * Inak by sa hra zasekla pri prvom výskyte každého typu prekážky (kompilácia trvá desiatky ms).
   */
  private precompile(): void {
    const scene = this.rig.scene;
    this.obstacles.withAllKinds(() => {
      const hidden: Object3D[] = [];
      scene.traverse((o) => {
        if (!o.visible) {
          o.visible = true;
          hidden.push(o);
        }
      });
      this.renderer.compile(scene, this.rig.camera);
      for (const o of hidden) o.visible = false;
    });
  }

  /** Volať z gesta používateľa (klik na „Spustiť“). */
  async start(): Promise<void> {
    // Zvuk sa musí odomknúť synchrónne v geste používateľa, ešte pred prvým await.
    this.sfx.unlock();
    // Slučku treba nastaviť pred session: three.js po štarte session prepne z okenného rAF na rAF
    // session. Keby sa nastavila až po štarte, bežali by obe a slučka by sa volala dvakrát za snímok.
    this.renderer.setAnimationLoop(this.loop);
    let session: XRSession;
    try {
      session = await startArSession(this.renderer, {
        onVisibilityChange: (state) => {
          if (state !== 'visible') this.game.autoPause('visibility');
        },
        onEnd: this.onEnd,
        onReferenceReset: () => this.game.autoPause('reset'),
      });
    } catch (err) {
      this.renderer.setAnimationLoop(null);
      throw err;
    }
    this.inputGuard.attach(session);
    this.session = session;
    this.frameRate.reset(this.game.settings.frameRate);
    this.tracking.reset();
    this.lastTime = -1;
    this.game.beginSession();
    document.body.classList.add('in-xr');
  }

  private readonly loop = (time: number, frame?: XRFrame): void => {
    // Volania okenného rAF bez XR snímku (pred session a po nej) nič nerobia.
    if (!frame || !this.session) return;
    const dt = this.lastTime < 0 ? 0 : (time - this.lastTime) / 1000;
    this.lastTime = time;

    if (this.frameRate.preferred !== this.game.settings.frameRate) this.frameRate.reset(this.game.settings.frameRate);
    this.frameRate.onFrame(this.session, time);
    readHeadPose(frame, this.renderer.xr.getReferenceSpace(), this.head);
    this.tick(dt);
    for (let i = 0; i < this.frameHooks.length; i++) this.frameHooks[i]!(time, dt);

    const game = this.game;
    applyPlayFrame(this.rig.playRoot, game.playFrame);
    this.playArea.update(dt, game.state === 'PLAYING');
    this.obstacles.sync(game.sim, game.alpha, dt);
    this.feedback.update(dt, game.alpha, game.sim);
    this.teammate.update(dt, game);
    this.darkening.update(dt, game, game.headWorld, this.rig.playRoot);
    this.vignette.update(dt, game.headWorld);
    this.ui.update(game, game.headWorld);
    this.ui.updateDebug(dt, game, this.renderer.info.render.calls, this.inputGuard.ignoredCount, this.frameRate.current, this.frameRate.autoNote());
    this.renderer.render(this.rig.scene, this.rig.camera);
  };

  /** Logika jedného snímku bez renderu (používa ho aj dev nástroj na posun času). */
  tick(dt: number): void {
    if (this.simulateTrackingLoss) this.head.valid = false;
    const tracking = this.tracking.update(dt, this.head.valid);
    if (tracking) this.devLog?.push(`tracking ${tracking}`);
    if (tracking === 'lost') this.game.autoPause('tracking');
    if (this.puckSource) this.puckSource(performance.now(), this.puck);
    else this.puck.valid = false;
    this.game.update(dt, this.head, this.puck);
    this.game.events.drain(this.onEvent);
  }

  private readonly onEvent = (e: GameEvent): void => {
    if (this.devLog && e.type !== 'dwellTick') this.devLog.push(`${e.type} ${e.id} ${e.n}`);
    const sfx = this.sfx;
    switch (e.type) {
      case 'dwellTick':
        sfx.tick(e.n);
        break;
      case 'activate':
      case 'recentered':
        sfx.confirm();
        break;
      case 'countdownBeep':
      case 'recenterBeep':
        sfx.beep();
        break;
      case 'go':
        sfx.beep(true);
        break;
      case 'passBody':
        sfx.bodyPass();
        this.obstacles.passOut(e.n);
        break;
      case 'passFloor':
        // Bez kamery (nič neposúdené) aspoň tichý swoosh za celý vzor.
        if (e.n === 0) sfx.swoosh(0.35);
        break;
      case 'floorHit':
        sfx.chime(this.game.sim.combo);
        this.spawnFeedback(e.n, 'hit');
        break;
      case 'floorMiss':
        sfx.miss();
        this.spawnFeedback(e.n, 'miss');
        break;
      case 'floorPass':
        this.spawnFeedback(e.n, 'pass');
        break;
      case 'hit':
        sfx.buzz();
        this.vignette.trigger();
        break;
      case 'calibrationFailed':
        sfx.buzz();
        break;
      case 'cleared':
        this.obstacles.fadeOut(e.n);
        break;
      case 'signal':
        sfx.call();
        break;
      case 'signalNag':
        sfx.nag(e.n / 100);
        break;
      case 'signalSeen':
        sfx.signalSeen();
        this.teammate.seen(e.n, this.game.sim.headUp);
        break;
      case 'gameOver':
        sfx.gameOver();
        break;
      default:
        break;
    }
  };

  /** Efekt pri prvku na zemi; code = id prekážky × MAX_ELEMENTS + prvok. */
  private spawnFeedback(code: number, kind: 'hit' | 'miss' | 'pass'): void {
    const id = Math.floor(code / MAX_ELEMENTS);
    const list = this.game.sim.obstacles;
    for (let i = 0; i < list.length; i++) {
      const o = list[i]!;
      if (o.active && o.id === id) {
        this.feedback.spawn(o, code - id * MAX_ELEMENTS, kind);
        return;
      }
    }
  }

  private readonly onEnd = (): void => {
    this.game.autoPause('sessionEnd');
    this.session = null;
    this.renderer.setAnimationLoop(null);
    document.body.classList.remove('in-xr');
    this.onSessionEnd?.();
  };

  private readonly onResize = (): void => {
    if (this.renderer.xr.isPresenting) return;
    this.rig.camera.aspect = window.innerWidth / window.innerHeight;
    this.rig.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
