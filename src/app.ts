/**
 * Zapojenie vrstiev: XR session → póza hlavy → hra (core) → udalosti (audio, efekty) → render a UI.
 * V hernej slučke sa nič nealokuje: póza, udalosti aj meshe sú predalokované.
 */
import type { WebGLRenderer } from 'three';
import { Sfx } from './audio/sfx';
import { CONFIG } from './config';
import type { GameEvent } from './core/events';
import { Game } from './core/game';
import type { KeyValueStorage } from './core/settings';
import { createHeadSample } from './core/types';
import { HitVignette } from './render/effects';
import { createResources } from './render/materials';
import { ObstacleViews } from './render/obstacleViews';
import { PlayAreaView } from './render/playArea';
import { createRenderer } from './render/renderer';
import { applyPlayFrame, createScene, type SceneRig } from './render/scene';
import { UiManager } from './ui/panels';
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
  readonly playArea = new PlayAreaView();
  readonly vignette = new HitVignette();
  readonly sfx = new Sfx(CONFIG.audio.volume);
  readonly head = createHeadSample();
  readonly tracking = new TrackingMonitor(CONFIG.tracking.lostGrace);
  readonly inputGuard = new InputGuard();
  session: XRSession | null = null;
  onSessionEnd: (() => void) | null = null;
  /** Len pre vývoj: simulácia straty trackingu (IWER ju nevie emulovať). */
  simulateTrackingLoss = false;
  /** Len pre vývoj: záznam udalostí pre skriptované testy. */
  devLog: string[] | null = null;
  private lastTime = -1;

  constructor(container: HTMLElement, storage: KeyValueStorage) {
    this.renderer = createRenderer(container);
    this.rig = createScene();
    this.game = new Game({ storage, seed: Date.now() & 0x7fffffff });
    this.rig.playRoot.add(this.playArea.root);
    this.obstacles = new ObstacleViews(createResources(), CONFIG);
    this.rig.playRoot.add(this.obstacles.root);
    this.rig.scene.add(this.vignette.mesh);
    this.ui = new UiManager(CONFIG, this.rig.playRoot, this.rig.scene);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.game.autoPause('visibility');
    });
    window.addEventListener('resize', this.onResize);
    // Na desktope (emulátor) prepína debug overlay kláves ` alebo F2.
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === 'F2') this.game.toggleDebug();
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

    readHeadPose(frame, this.renderer.xr.getReferenceSpace(), this.head);
    this.tick(dt);

    const game = this.game;
    applyPlayFrame(this.rig.playRoot, game.playFrame);
    this.playArea.update(dt, game.state === 'PLAYING');
    this.obstacles.sync(game.sim, game.alpha, dt);
    this.vignette.update(dt, game.headWorld);
    this.ui.update(game, game.headWorld);
    this.ui.updateDebug(dt, game, this.renderer.info.render.calls, this.inputGuard.ignoredCount);
    this.renderer.render(this.rig.scene, this.rig.camera);
  };

  /** Logika jedného snímku bez renderu (používa ho aj dev nástroj na posun času). */
  tick(dt: number): void {
    if (this.simulateTrackingLoss) this.head.valid = false;
    const tracking = this.tracking.update(dt, this.head.valid);
    if (tracking) this.devLog?.push(`tracking ${tracking}`);
    if (tracking === 'lost') this.game.autoPause('tracking');
    this.game.update(dt, this.head);
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
        sfx.swoosh(1);
        break;
      case 'passFloor':
        sfx.swoosh(0.35);
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
      case 'gameOver':
        sfx.gameOver();
        break;
      default:
        break;
    }
  };

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
