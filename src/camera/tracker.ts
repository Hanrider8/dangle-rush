/**
 * Sledovanie puku na hlavnom vlákne: z výsledkov workera a histórie pózy hlavy spočíta, kde puk leží
 * na podlahe, zbiera pozorovania na samokalibráciu a štatistiky pre panel a správu.
 *
 * Čas snímky sa prevedie na čas hlavného vlákna (TimeSync), odpočíta sa oneskorenie kamery a póza
 * hlavy sa vezme z histórie v čase zachytenia. Lúč z pixelu sa pretne s rovinou vo výške stredu puku.
 */
import type { Config } from '../config';
import type { PlayFrame } from '../core/playFrame';
import type { KeyValueStorage } from '../core/settings';
import type { HeadSample, Vec3 } from '../core/types';
import type { CalibResult } from '../tracking/calibration';
import { CameraModel, cameraSideFromLabel, guessParams, type CamParams } from '../tracking/cameraModel';
import { PoseHistory, createPose } from '../tracking/poseHistory';
import { TimeSync } from '../tracking/timeSync';
import type { CalibRequest, CalibResponse, DetectionMessage, FrameInfoMessage } from './protocol';

export type TargetKind = 'green' | 'orange';
export type ParamsSource = 'odhad' | 'uložená kalibrácia' | 'kalibrácia';

export const CALIB_KEY = 'dangleRush.camCalib.v1';

interface StoredCalib {
  params: CamParams;
  rmsDeg: number;
  date: string;
}

const OBS_CAP = 1024;
const SPREAD_N = 30;

export class PuckTracker {
  readonly poses = new PoseHistory(1500);
  readonly sync = new TimeSync(90);
  readonly model: CameraModel;
  target: TargetKind = 'green';
  paramsSource: ParamsSource = 'odhad';
  deviceLabel = '';
  frameInfo: FrameInfoMessage | null = null;

  /** Posledná poloha puku (svet aj herný priestor), čas zachytenia a príchodu (ms hlavného vlákna). */
  readonly puck = {
    valid: false,
    x: 0,
    z: 0,
    playX: 0,
    playZ: 0,
    capture: 0,
    received: -Infinity,
    u: 0,
    v: 0,
    radius: 0,
    expectedRadius: 0,
  };

  readonly stats = {
    frames: 0,
    found: 0,
    projected: 0,
    framesInXr: 0,
    fps: 0,
    foundRate: 0,
    procMs: 0,
    lastFrameAt: -Infinity,
    srcWidth: 0,
    srcHeight: 0,
    /** Rozptyl polohy puku za posledných ~30 snímok (cm); pri nehybnom puku ukazuje presnosť. */
    spreadCm: NaN,
  };

  readonly calib = {
    status: 'čaká na snímky',
    solving: false,
    lastRequestAt: -Infinity,
    attempts: 0,
    accepted: 0,
    last: null as CalibResult | null,
    lastMs: 0,
  };

  private readonly obsT = new Float64Array(OBS_CAP);
  private readonly obsU = new Float64Array(OBS_CAP);
  private readonly obsV = new Float64Array(OBS_CAP);
  private obsHead = 0;
  private obsCount = 0;
  private readonly spreadX = new Float64Array(SPREAD_N);
  private readonly spreadZ = new Float64Array(SPREAD_N);
  private spreadHead = 0;
  private spreadCount = 0;
  private readonly pose = createPose();
  private readonly hit: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly origin: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly playPoint: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly calibWorker: Worker;
  private calibId = 0;
  /** Kvalita prijatej kalibrácie (body / chyba²); lepší výsledok ju nahradí. */
  private bestQuality = 0;
  private windowStart = -1;
  private windowFrames = 0;
  private windowFound = 0;

  constructor(
    private readonly cfg: Config,
    private readonly storage: KeyValueStorage,
  ) {
    const c = cfg.camera;
    this.model = new CameraModel(guessParams(c.width, c.height, c.guess.hfovDeg, c.guess.offset, 0, c.guess.latencyMs));
    this.calibWorker = new Worker(new URL('./calibWorker.ts', import.meta.url), { type: 'module' });
    this.calibWorker.onmessage = (e: MessageEvent<CalibResponse>) => this.onCalibResult(e.data);
    this.calibWorker.onerror = (e) => {
      this.calib.solving = false;
      this.calib.status = `chyba kalibrácie: ${e.message}`;
    };
  }

  get params(): CamParams {
    return this.model.params;
  }

  /** Výška stredu cieľa nad podlahou a jeho polomer (m). */
  get planeY(): number {
    return this.cfg.camera.targets[this.target].centerHeight;
  }

  get targetRadius(): number {
    return this.cfg.camera.targets[this.target].radius;
  }

  /** Nová kamera alebo rozlíšenie: uložená kalibrácia, inak odhad podľa strany kamery. */
  useCamera(label: string, width: number, height: number): void {
    this.deviceLabel = label;
    const stored = this.loadStored(label, width, height);
    if (stored) {
      this.model.setParams(stored.params);
      this.paramsSource = 'uložená kalibrácia';
      this.calib.status = `uložená kalibrácia (${stored.date}), overím ju`;
    } else {
      const c = this.cfg.camera;
      const side = cameraSideFromLabel(label);
      this.model.setParams(guessParams(width, height, c.guess.hfovDeg, c.guess.offset, side, c.guess.latencyMs));
      this.paramsSource = 'odhad';
      this.calib.status = 'nekalibrované';
    }
    this.obsCount = 0;
    this.spreadCount = 0;
    this.puck.valid = false;
    this.bestQuality = 0;
  }

  /** Zmaže uloženú kalibráciu tejto kamery a vráti sa k odhadu. */
  resetCalibration(): void {
    const all = this.readAll();
    delete all[this.key(this.deviceLabel, this.params.width, this.params.height)];
    this.writeAll(all);
    this.useCamera(this.deviceLabel, this.params.width, this.params.height);
  }

  /** V každom XR snímku: póza hlavy do histórie. */
  onXrFrame(time: number, head: HeadSample): void {
    if (head.valid) this.poses.push(time, head.px, head.py, head.pz, head.qx, head.qy, head.qz, head.qw);
  }

  onDetection(msg: DetectionMessage, playFrame: PlayFrame, inXr: boolean): void {
    const now = performance.now();
    const s = this.stats;
    if (msg.srcWidth !== this.params.width || msg.srcHeight !== this.params.height) {
      this.useCamera(this.deviceLabel, msg.srcWidth, msg.srcHeight);
    }
    s.srcWidth = msg.srcWidth;
    s.srcHeight = msg.srcHeight;
    s.frames++;
    if (inXr) s.framesInXr++;
    s.lastFrameAt = now;
    s.procMs = s.frames === 1 ? msg.procMs : s.procMs * 0.9 + msg.procMs * 0.1;
    if (this.windowStart < 0) this.windowStart = now;
    this.windowFrames++;
    if (msg.found) this.windowFound++;
    if (now - this.windowStart >= 1000) {
      s.fps = (this.windowFrames * 1000) / (now - this.windowStart);
      s.foundRate = this.windowFound / this.windowFrames;
      this.windowStart = now;
      this.windowFrames = 0;
      this.windowFound = 0;
    }

    const frameTime = this.sync.map(msg.timestampUs, msg.arrival - performance.timeOrigin);
    if (!msg.found) return;
    s.found++;
    this.addObservation(frameTime, msg.u, msg.v);

    const capture = frameTime - this.params.latencyMs;
    if (!this.poses.sample(capture, this.pose)) return;
    if (!this.model.pixelToPlane(this.pose, msg.u, msg.v, this.planeY, this.hit)) return;
    const p = this.puck;
    p.valid = true;
    p.x = this.hit.x;
    p.z = this.hit.z;
    p.capture = capture;
    p.received = now;
    p.u = msg.u;
    p.v = msg.v;
    p.radius = msg.radius;
    const o = this.model.origin(this.pose, this.origin);
    const dist = Math.hypot(this.hit.x - o.x, this.hit.y - o.y, this.hit.z - o.z);
    p.expectedRadius = (this.params.f * this.targetRadius) / dist;
    playFrame.toPlayPoint(this.playPoint, this.hit.x, this.hit.y, this.hit.z);
    p.playX = this.playPoint.x;
    p.playZ = this.playPoint.z;
    s.projected++;
    this.addSpread(this.hit.x, this.hit.z);
  }

  /**
   * Raz za intervalMs pošle pozorovania na samokalibráciu. Nie počas hry (puk sa hýbe); po prijatí
   * beží ďalej a lepší výsledok nahradí horší.
   */
  maybeCalibrate(nowMs: number, allowed: boolean): void {
    const c = this.cfg.camera.calibration;
    const cal = this.calib;
    if (!allowed || cal.solving || nowMs - cal.lastRequestAt < c.intervalMs) return;
    const calibrated = this.paramsSource === 'kalibrácia';
    cal.lastRequestAt = nowMs;
    const from = nowMs - c.windowMs;
    const idx: number[] = [];
    for (let j = 0; j < this.obsCount; j++) {
      const i = (this.obsHead - 1 - j + OBS_CAP) % OBS_CAP;
      if (this.obsT[i]! < from) break;
      idx.push(i);
    }
    if (idx.length < c.minObservations) {
      if (!calibrated) {
        cal.status =
          idx.length === 0 ? 'polož puk do záberu kamery' : `zbieram pozorovania (${idx.length}/${c.minObservations})`;
      }
      return;
    }
    idx.reverse();
    const t = Float64Array.from(idx, (i) => this.obsT[i]!);
    const u = Float64Array.from(idx, (i) => this.obsU[i]!);
    const v = Float64Array.from(idx, (i) => this.obsV[i]!);
    const poses = this.poses.exportRange(t[0]! - c.maxLatencyMs - 100, t[t.length - 1]! + 100);
    if (poses.times.length < 10) {
      if (!calibrated) cal.status = 'chýba póza hlavy (kalibruje sa len v AR)';
      return;
    }
    const req: CalibRequest = {
      type: 'solve',
      id: ++this.calibId,
      t,
      u,
      v,
      poseTimes: poses.times,
      poseData: poses.data,
      init: { ...this.params },
      planeY: this.planeY,
      config: { ...c },
    };
    this.calibWorker.postMessage(req, [t.buffer, u.buffer, v.buffer, poses.times.buffer, poses.data.buffer]);
    cal.solving = true;
  }

  private onCalibResult(res: CalibResponse): void {
    const cal = this.calib;
    cal.solving = false;
    cal.attempts++;
    cal.last = res.result;
    cal.lastMs = res.ms;
    const r = res.result;
    // Medzitým sa zmenila kamera alebo rozlíšenie: výsledok už neplatí.
    if (r.params.width !== this.params.width || r.params.height !== this.params.height) return;
    if (!r.ok) {
      if (this.paramsSource !== 'kalibrácia') cal.status = r.reason;
      return;
    }
    const quality = r.inliers / Math.max(r.rmsDeg, 0.15) ** 2;
    if (this.paramsSource === 'kalibrácia' && quality <= this.bestQuality) return;
    this.bestQuality = quality;
    this.model.setParams(r.params);
    this.paramsSource = 'kalibrácia';
    cal.accepted++;
    cal.status = `hotová: chyba ${r.rmsDeg.toFixed(2).replace('.', ',')}°, oneskorenie ${Math.round(r.params.latencyMs)} ms`;
    const all = this.readAll();
    all[this.key(this.deviceLabel, r.params.width, r.params.height)] = {
      params: r.params,
      rmsDeg: r.rmsDeg,
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    this.writeAll(all);
  }

  private addObservation(t: number, u: number, v: number): void {
    this.obsT[this.obsHead] = t;
    this.obsU[this.obsHead] = u;
    this.obsV[this.obsHead] = v;
    this.obsHead = (this.obsHead + 1) % OBS_CAP;
    if (this.obsCount < OBS_CAP) this.obsCount++;
  }

  private addSpread(x: number, z: number): void {
    this.spreadX[this.spreadHead] = x;
    this.spreadZ[this.spreadHead] = z;
    this.spreadHead = (this.spreadHead + 1) % SPREAD_N;
    if (this.spreadCount < SPREAD_N) this.spreadCount++;
    const n = this.spreadCount;
    if (n < 5) {
      this.stats.spreadCm = NaN;
      return;
    }
    let mx = 0;
    let mz = 0;
    for (let i = 0; i < n; i++) {
      mx += this.spreadX[i]!;
      mz += this.spreadZ[i]!;
    }
    mx /= n;
    mz /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (this.spreadX[i]! - mx) ** 2 + (this.spreadZ[i]! - mz) ** 2;
    this.stats.spreadCm = Math.sqrt(v / n) * 100;
  }

  private key(label: string, width: number, height: number): string {
    return `${label || 'kamera'}|${width}x${height}`;
  }

  private readAll(): Record<string, StoredCalib> {
    try {
      const text = this.storage.getItem(CALIB_KEY);
      const raw: unknown = text ? JSON.parse(text) : {};
      return typeof raw === 'object' && raw !== null ? (raw as Record<string, StoredCalib>) : {};
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, StoredCalib>): void {
    try {
      this.storage.setItem(CALIB_KEY, JSON.stringify(all));
    } catch {
      // Plné alebo zablokované úložisko: kalibrácia platí len do zatvorenia stránky.
    }
  }

  private loadStored(label: string, width: number, height: number): StoredCalib | null {
    const s = this.readAll()[this.key(label, width, height)];
    if (!s || typeof s !== 'object' || !s.params) return null;
    const p = s.params;
    const nums = [p.f, p.cx, p.cy, p.rx, p.ry, p.rz, p.tx, p.ty, p.tz, p.latencyMs];
    if (!nums.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    if (p.width !== width || p.height !== height) return null;
    return s;
  }
}
