/** Správy medzi hlavným vláknom a workermi sledovania puku kamerou. */
import type { CalibConfig, CalibResult } from '../tracking/calibration';
import type { CamParams } from '../tracking/cameraModel';
import type { LearnOptions, LearnResult } from '../tracking/colorLearn';
import type { ColorProfile, DetectorLimits } from '../tracking/detector';

export interface FrameWorkerConfig {
  type: 'config';
  profile: ColorProfile;
  limits: DetectorLimits;
  learn: LearnOptions;
  procWidth: number;
  previewIntervalMs: number;
}

export type ToFrameWorker =
  | FrameWorkerConfig
  /** Snímky z MediaStreamTrackProcessor (hlavná cesta). */
  | { type: 'stream'; readable: ReadableStream<VideoFrame> }
  /** Záložná cesta: zmenšená snímka z <video> a rozmery kamery. */
  | { type: 'bitmap'; bitmap: ImageBitmap; arrival: number; srcWidth: number; srcHeight: number }
  /** Naučiť farbu puku z najbližšej snímky; bod ťuknutia v náhľade (0–1). */
  | { type: 'learn'; x: number; y: number }
  | { type: 'stop' };

/** Výsledok jednej snímky. Pixely sú v rozlíšení kamery. */
export interface DetectionMessage {
  type: 'det';
  /** Časová značka snímky (µs; 0 = chýba) a čas príchodu (ms, performance.timeOrigin + now). */
  timestampUs: number;
  arrival: number;
  srcWidth: number;
  srcHeight: number;
  found: boolean;
  u: number;
  v: number;
  /** Polomer kruhu s rovnakou plochou ako škvrna (px kamery). */
  radius: number;
  fill: number;
  candidates: number;
  colorPixels: number;
  /** Trvanie spracovania vo workeri (ms) a cesta: priamo z YUV alebo cez canvas. */
  procMs: number;
  method: 'yuv' | 'canvas';
}

/** Vlastnosti prvej snímky (do správy pre vývoj). */
export interface FrameInfoMessage {
  type: 'info';
  format: string;
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  colorSpace: string;
  rotation: string;
  metadata: string;
  timestampUs: number;
}

export type FromFrameWorker =
  | DetectionMessage
  | FrameInfoMessage
  | { type: 'preview'; bitmap: ImageBitmap }
  | { type: 'learned'; result: LearnResult }
  | { type: 'error'; message: string }
  | { type: 'ended' };

export interface CalibRequest {
  type: 'solve';
  id: number;
  t: Float64Array;
  u: Float64Array;
  v: Float64Array;
  poseTimes: Float64Array;
  poseData: Float64Array;
  init: CamParams;
  planeY: number;
  config: CalibConfig;
}

export interface CalibResponse {
  type: 'result';
  id: number;
  result: CalibResult;
  ms: number;
}
