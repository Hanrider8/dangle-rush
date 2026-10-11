/**
 * Worker testu kamery: snímku zmenší, nájde v nej farebný puk a pošle výsledok.
 * Raz za previewIntervalMs pošle aj náhľad (pixely farby cieľa fialovo, nájdený puk v krúžku).
 * Beží mimo hlavného vlákna, takže hra drží snímkovú frekvenciu.
 */
import { BlobDetector, type Blob } from '../tracking/detector';
import type { DetectionMessage, FrameInfoMessage, FrameWorkerConfig, FromFrameWorker, ToFrameWorker } from './protocol';

const scope = self as unknown as {
  postMessage(message: FromFrameWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToFrameWorker>) => void) | null;
};

let config: FrameWorkerConfig | null = null;
let detector: BlobDetector | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let preview: OffscreenCanvas | null = null;
let pctx: OffscreenCanvasRenderingContext2D | null = null;
let lastPreview = -Infinity;
/** Každý nový stream zvýši generáciu; starý cyklus čítania potom skončí. */
let generation = 0;
let infoSent = false;

function ensureSize(srcWidth: number, srcHeight: number, procWidth: number): void {
  const w = Math.min(procWidth, srcWidth);
  const h = Math.max(1, Math.round((w * srcHeight) / srcWidth));
  if (canvas && canvas.width === w && canvas.height === h) return;
  canvas = new OffscreenCanvas(w, h);
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  preview = new OffscreenCanvas(w, h);
  pctx = preview.getContext('2d');
  detector = new BlobDetector(w, h);
}

function process(source: CanvasImageSource, srcWidth: number, srcHeight: number, timestampUs: number, arrival: number): void {
  if (!config || srcWidth <= 0 || srcHeight <= 0) return;
  const t0 = performance.now();
  ensureSize(srcWidth, srcHeight, config.procWidth);
  if (!ctx || !detector || !canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.drawImage(source, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const blob = detector.detect(image.data, config.profile, config.limits);
  const sx = srcWidth / w;
  const sy = srcHeight / h;
  const msg: DetectionMessage = {
    type: 'det',
    timestampUs,
    arrival,
    srcWidth,
    srcHeight,
    found: blob.found,
    u: blob.cx * sx,
    v: blob.cy * sy,
    radius: Math.sqrt(blob.area / Math.PI) * sx,
    fill: blob.fill,
    candidates: blob.candidates,
    colorPixels: blob.colorPixels,
    procMs: 0,
  };
  if (t0 - lastPreview >= config.previewIntervalMs) {
    lastPreview = t0;
    sendPreview(image, blob);
  }
  msg.procMs = performance.now() - t0;
  scope.postMessage(msg);
}

function sendPreview(image: ImageData, blob: Blob): void {
  if (!preview || !pctx || !detector) return;
  const d = image.data;
  const mask = detector.mask;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    d[4 * i] = 255;
    d[4 * i + 1] = 0;
    d[4 * i + 2] = 255;
  }
  pctx.putImageData(image, 0, 0);
  if (blob.found) {
    pctx.strokeStyle = '#ffff00';
    pctx.lineWidth = 2;
    pctx.beginPath();
    pctx.arc(blob.cx, blob.cy, Math.max(5, Math.sqrt(blob.area / Math.PI) + 4), 0, Math.PI * 2);
    pctx.stroke();
  }
  const bitmap = preview.transferToImageBitmap();
  scope.postMessage({ type: 'preview', bitmap }, [bitmap]);
}

function sendInfo(frame: VideoFrame): void {
  const extra = frame as unknown as { metadata?: () => unknown; rotation?: unknown; flip?: unknown };
  let metadata = '–';
  try {
    if (typeof extra.metadata === 'function') metadata = JSON.stringify(extra.metadata());
  } catch (err) {
    metadata = `chyba: ${String(err)}`;
  }
  let colorSpace = '–';
  try {
    colorSpace = JSON.stringify(frame.colorSpace?.toJSON?.() ?? frame.colorSpace);
  } catch {
    // nevadí
  }
  const info: FrameInfoMessage = {
    type: 'info',
    format: String(frame.format),
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    displayWidth: frame.displayWidth,
    displayHeight: frame.displayHeight,
    colorSpace,
    rotation: `${String(extra.rotation ?? '–')} / flip ${String(extra.flip ?? '–')}`,
    metadata,
    timestampUs: frame.timestamp,
  };
  scope.postMessage(info);
}

async function readLoop(readable: ReadableStream<VideoFrame>, gen: number): Promise<void> {
  const reader = readable.getReader();
  try {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      const arrival = performance.timeOrigin + performance.now();
      try {
        if (gen !== generation) break;
        if (!infoSent) {
          infoSent = true;
          sendInfo(frame);
        }
        process(frame, frame.displayWidth, frame.displayHeight, frame.timestamp, arrival);
      } finally {
        frame.close();
      }
    }
  } catch (err) {
    scope.postMessage({ type: 'error', message: `čítanie snímok: ${String(err)}` });
  } finally {
    reader.releaseLock();
    void readable.cancel().catch(() => undefined);
    if (gen === generation) scope.postMessage({ type: 'ended' });
  }
}

scope.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'config':
      config = msg;
      break;
    case 'stream':
      generation++;
      infoSent = false;
      void readLoop(msg.readable, generation);
      break;
    case 'bitmap':
      try {
        process(msg.bitmap, msg.srcWidth, msg.srcHeight, 0, msg.arrival);
      } catch (err) {
        scope.postMessage({ type: 'error', message: `spracovanie: ${String(err)}` });
      } finally {
        msg.bitmap.close();
      }
      break;
    case 'stop':
      generation++;
      break;
  }
};
