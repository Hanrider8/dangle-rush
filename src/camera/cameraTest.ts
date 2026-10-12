/**
 * Test sledovania puku kamerou headsetu (`?cam=1`). Načíta sa dynamicky len v tomto režime.
 *
 * Úvodná stránka: výber cieľa, rozlíšenia a kamery, povolenie, náhľad a správa pre vývoj.
 * V AR: krúžok na podlahe, obrys záberu kamery, panel s náhľadom a samokalibrácia.
 * Hra puk zatiaľ nevyhodnocuje.
 */
import type { App } from '../app';
import { CONFIG } from '../config';
import type { KeyValueStorage } from '../core/settings';
import { FrameStats } from './frameStats';
import { buildReport } from './report';
import { CameraSource } from './source';
import { PuckTracker } from './tracker';
import { TrackerView } from './view';

export interface CameraTestOptions {
  /** false = vynútená záložná cesta cez <video> (`?cammstp=0`). */
  allowProcessor: boolean;
  /** Len vývoj: virtuálna kamera namiesto getUserMedia. */
  simStream?: () => MediaStream;
}

const PREFS_KEY = 'dangleRush.camTest.v1';
/** Keď v AR toľko ms neprišla snímka, kamera sa raz reštartuje. */
const NO_FRAMES_RESTART_MS = 3000;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Chýba prvok #${id}`);
  return e as T;
}

function describeError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Prístup ku kamere je zamietnutý. Povoľ „Kamery headsetu“ cez zámok vľavo od adresy a skús znova.';
    case 'NotFoundError':
      return 'Kamera sa nenašla.';
    case 'NotReadableError':
      return 'Kameru práve používa iná stránka alebo aplikácia.';
    case 'OverconstrainedError':
      return 'Kamera nepodporuje zvolené nastavenie, skús iné rozlíšenie.';
    default:
      return `Kamera sa nespustila: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function installCameraTest(app: App, storage: KeyValueStorage, options: CameraTestOptions) {
  const cfg = CONFIG.camera;
  const targetSel = el<HTMLSelectElement>('cam-target');
  const resSel = el<HTMLSelectElement>('cam-res');
  const deviceSel = el<HTMLSelectElement>('cam-device');
  const enableBtn = el<HTMLButtonElement>('cam-enable');
  const status = el<HTMLParagraphElement>('cam-status');
  const canvas = el<HTMLCanvasElement>('cam-preview');
  const reportPre = el<HTMLPreElement>('cam-report');
  const copyBtn = el<HTMLButtonElement>('cam-copy');
  const resetBtn = el<HTMLButtonElement>('cam-reset');
  const details = el<HTMLDetailsElement>('cam-details');
  el<HTMLElement>('cam').hidden = false;
  details.hidden = false;

  const source = new CameraSource(options.allowProcessor);
  const tracker = new PuckTracker(CONFIG, storage);
  const view = new TrackerView(CONFIG, app.rig.scene, app.rig.playRoot);
  const pctx = canvas.getContext('2d');
  let requested = { width: cfg.width, height: cfg.height, frameRate: cfg.frameRate };
  let xrSessions = 0;
  let restarts = 0;
  let inXr = false;
  let xrStart = 0;
  let restartedThisSession = false;
  let lastXrTime = -1;
  let wasCalibrating = false;
  /** Plynulosť XR snímok: celkovo, počas hry a bez bežiacej kamery (na porovnanie). */
  const xr = { all: new FrameStats(), playing: new FrameStats(), noCamera: new FrameStats(), targetHz: 0 };

  try {
    const prefs = JSON.parse(storage.getItem(PREFS_KEY) ?? '{}') as { target?: string; res?: string };
    if (prefs.target === 'green' || prefs.target === 'orange') targetSel.value = prefs.target;
    if (prefs.res && [...resSel.options].some((o) => o.value === prefs.res)) resSel.value = prefs.res;
  } catch {
    // poškodené nastavenia testu: predvolené hodnoty
  }
  const savePrefs = () => {
    try {
      storage.setItem(PREFS_KEY, JSON.stringify({ target: targetSel.value, res: resSel.value }));
    } catch {
      // nevadí
    }
  };

  const setStatus = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  const configure = () => {
    tracker.target = targetSel.value === 'orange' ? 'orange' : 'green';
    source.configure({
      type: 'config',
      profile: cfg.targets[tracker.target],
      limits: cfg.detector,
      procWidth: cfg.procWidth,
      previewIntervalMs: cfg.previewIntervalMs,
    });
  };
  configure();

  source.onMessage = (msg) => {
    switch (msg.type) {
      case 'det':
        tracker.onDetection(msg, app.game.playFrame, inXr);
        break;
      case 'preview':
        if (pctx && !document.body.classList.contains('in-xr')) {
          if (canvas.width !== msg.bitmap.width || canvas.height !== msg.bitmap.height) {
            canvas.width = msg.bitmap.width;
            canvas.height = msg.bitmap.height;
          }
          pctx.drawImage(msg.bitmap, 0, 0);
        }
        view.setPreview(msg.bitmap);
        break;
      case 'info':
        tracker.frameInfo = msg;
        break;
      case 'error':
        source.note(msg.message);
        break;
      case 'ended':
        source.note('snímky prestali prichádzať (stream skončil)');
        break;
    }
  };

  const fillDevices = () => {
    const previous = deviceSel.disabled ? '' : deviceSel.value;
    deviceSel.replaceChildren();
    source.devices.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `kamera ${i + 1}`;
      deviceSel.append(o);
    });
    // Pri reštarte ostane vybraná kamera, inak predvolená zadná.
    const keep = source.devices.some((d) => d.deviceId === previous);
    const def = keep ? previous : source.defaultDeviceId();
    if (def) deviceSel.value = def;
    deviceSel.disabled = source.devices.length === 0;
  };

  const startCamera = async () => {
    const [w, h] = resSel.value.split('x').map(Number);
    requested = { width: w || cfg.width, height: h || cfg.height, frameRate: cfg.frameRate };
    if (options.simStream) {
      source.stop();
      source.attach(options.simStream());
    } else {
      await source.start({ deviceId: deviceSel.value || undefined, ...requested });
    }
    const label = source.track?.label ?? '';
    const s = source.track?.getSettings() ?? {};
    tracker.useCamera(label, s.width ?? requested.width, s.height ?? requested.height);
    // Puk z kamery ide do hry; v nastaveniach pribudne Kalibrácia puku.
    app.puckSource = (nowMs, out) => tracker.fillPuck(nowMs, out);
    app.game.setPuckTracking(true);
    setStatus(
      `Kamera beží: ${label || 'kamera'} · ${s.width ?? '?'}×${s.height ?? '?'} @ ${s.frameRate ? Math.round(s.frameRate) : '?'} fps · ${source.pipeline === 'mstp' ? 'MediaStreamTrackProcessor' : 'záloha <video>'}`,
    );
  };

  enableBtn.addEventListener('click', () => {
    enableBtn.disabled = true;
    setStatus('Pýtam si povolenie kamery…');
    (async () => {
      if (!options.simStream) {
        await source.requestPermission();
        fillDevices();
      }
      await startCamera();
      enableBtn.textContent = 'Reštartovať kameru';
    })()
      .catch((err: unknown) => setStatus(describeError(err), true))
      .finally(() => {
        enableBtn.disabled = false;
      });
  });

  const restartIfRunning = () => {
    savePrefs();
    if (source.stream) void startCamera().catch((err: unknown) => setStatus(describeError(err), true));
  };
  resSel.addEventListener('change', restartIfRunning);
  deviceSel.addEventListener('change', restartIfRunning);
  targetSel.addEventListener('change', () => {
    savePrefs();
    configure();
    tracker.useCamera(tracker.deviceLabel, tracker.params.width, tracker.params.height);
  });

  const reportText = () =>
    buildReport({
      source,
      tracker,
      requested,
      xrSessions,
      restarts,
      xr,
      frameRate: app.frameRate.describe(),
      version: `build ${__BUILD_TIME__}`,
    });

  copyBtn.addEventListener('click', () => {
    const text = reportText();
    reportPre.textContent = text;
    navigator.clipboard.writeText(text).then(
      () => {
        copyBtn.textContent = 'Skopírované';
      },
      () => {
        // Bez prístupu k schránke aspoň označí text, aby sa dal skopírovať ručne.
        const range = document.createRange();
        range.selectNodeContents(reportPre);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        copyBtn.textContent = 'Označené, skopíruj ručne';
      },
    );
    window.setTimeout(() => {
      copyBtn.textContent = 'Kopírovať správu';
    }, 2500);
  });

  resetBtn.addEventListener('click', () => {
    tracker.resetCalibration();
    setStatus('Kalibrácia kamery je zmazaná. V AR sa nakalibruje znova.');
  });

  app.frameHooks.push((time, dt) => {
    const now = performance.now();
    if (app.session && !inXr) {
      inXr = true;
      xrSessions++;
      xrStart = now;
      restartedThisSession = false;
      lastXrTime = -1;
      source.note(`AR session ${xrSessions} začala`);
    }
    const state = app.game.state;
    // Kalibrácia puku beží len v Nastavenia → Kalibrácia puku; pri otvorení začne odznova.
    const calibrating = app.game.sub === 'puck';
    if (calibrating && !wasCalibrating) tracker.beginCalibration();
    wasCalibrating = calibrating;
    if (lastXrTime >= 0) {
      xr.targetHz = app.session?.frameRate ?? 90;
      const target = 1000 / xr.targetHz;
      const interval = time - lastXrTime;
      xr.all.add(interval, target);
      if (state === 'PLAYING') xr.playing.add(interval, target);
      if (!source.stream) xr.noCamera.add(interval, target);
    }
    lastXrTime = time;
    tracker.onXrFrame(time, app.head);
    tracker.maybeCalibrate(now, calibrating && state !== 'PLAYING' && state !== 'COUNTDOWN');
    view.update(dt, now, tracker, source, app.game, app.head, xr.all);
    // V AR neprichádzajú snímky: kamera sa raz reštartuje (povolenie už je, výzva sa neukáže).
    if (
      source.stream &&
      !restartedThisSession &&
      now - xrStart > NO_FRAMES_RESTART_MS &&
      now - tracker.stats.lastFrameAt > NO_FRAMES_RESTART_MS
    ) {
      restartedThisSession = true;
      restarts++;
      source.note('v AR neprichádzajú snímky: reštartujem kameru');
      void startCamera().catch((err: unknown) => source.note(`reštart zlyhal: ${describeError(err)}`));
    }
  });

  // Správa na úvodnej stránke sa obnovuje každú sekundu (v AR nie je vidieť).
  window.setInterval(() => {
    if (!app.session && inXr) {
      inXr = false;
      source.note(`AR session ${xrSessions} skončila`);
      // Po návrate z AR je správa hneď otvorená na skopírovanie alebo odfotenie.
      details.open = true;
    }
    if (!document.body.classList.contains('in-xr')) reportPre.textContent = reportText();
  }, 1000);
  reportPre.textContent = reportText();

  const api = { tracker, source, view, report: reportText };
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__drCam = api;
  return api;
}
