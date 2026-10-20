/**
 * Zdroj snímok pre test kamery: povolenie, výber kamery headsetu, getUserMedia a cesta do workera.
 *
 * Hlavná cesta je MediaStreamTrackProcessor: snímky (VideoFrame s časovou značkou zachytenia) idú
 * priamo do workera. Ak chýba, záloha 30× za sekundu zmenší obraz z <video> cez createImageBitmap.
 */
import type { FromFrameWorker, FrameWorkerConfig, ToFrameWorker } from './protocol';

export interface CameraStartOptions {
  deviceId?: string;
  width: number;
  height: number;
  frameRate: number;
}

type ProcessorCtor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => {
  readable: ReadableStream<VideoFrame>;
};

function processorCtor(): ProcessorCtor | null {
  const g = globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorCtor };
  return typeof g.MediaStreamTrackProcessor === 'function' ? g.MediaStreamTrackProcessor : null;
}

export class CameraSource {
  readonly worker: Worker;
  stream: MediaStream | null = null;
  track: MediaStreamTrack | null = null;
  devices: MediaDeviceInfo[] = [];
  /** 'mstp' = MediaStreamTrackProcessor, 'video' = záloha cez <video>. */
  pipeline: '' | 'mstp' | 'video' = '';
  /** Záznam udalostí pre správu (štart, chyby, mute/ended…). */
  readonly log: string[] = [];
  onMessage: ((msg: FromFrameWorker) => void) | null = null;
  private previews = true;
  private video: HTMLVideoElement | null = null;
  private grabTimer = 0;
  private grabBusy = false;
  private procWidth = 320;
  private lastOptions: CameraStartOptions | null = null;
  private readonly t0 = performance.now();

  constructor(private readonly allowProcessor: boolean) {
    this.worker = new Worker(new URL('./frameWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromFrameWorker>) => this.onMessage?.(e.data);
    this.worker.onerror = (e) => this.note(`chyba workera: ${e.message}`);
  }

  get processorAvailable(): boolean {
    return processorCtor() !== null;
  }

  note(text: string): void {
    const s = ((performance.now() - this.t0) / 1000).toFixed(1);
    this.log.push(`${s} s: ${text}`);
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
  }

  configure(cfg: FrameWorkerConfig): void {
    this.procWidth = cfg.procWidth;
    this.post(cfg);
  }

  /** Zapne alebo vypne náhľady z workera (pošle sa len pri zmene). */
  setPreviews(enabled: boolean): void {
    if (enabled === this.previews) return;
    this.previews = enabled;
    this.post({ type: 'previews', enabled });
  }

  /** Naučí farbu puku z najbližšej snímky; (x, y) je bod ťuknutia v náhľade (0–1). Výsledok príde ako 'learned'. */
  learn(x: number, y: number): void {
    this.post({ type: 'learn', x, y });
  }

  /** Vypýta povolenie (zobrazí výzvu) a načíta zoznam kamier; názvy sú známe až po povolení. */
  async requestPermission(): Promise<void> {
    // facingMode „environment“ smeruje na kamery headsetu (facing back), nie na kameru avatara.
    const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    for (const t of probe.getTracks()) t.stop();
    await this.refreshDevices();
  }

  async refreshDevices(): Promise<void> {
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all.filter((d) => d.kind === 'videoinput');
  }

  /** Predvolená kamera: prvá zadná („facing back“), inak prvá v zozname. */
  defaultDeviceId(): string | undefined {
    const back = this.devices.find((d) => /facing back|back|rear|environment/i.test(d.label));
    return (back ?? this.devices[0])?.deviceId || undefined;
  }

  async start(opts: CameraStartOptions): Promise<void> {
    this.stop();
    this.lastOptions = opts;
    const video: MediaTrackConstraints = {
      width: { ideal: opts.width },
      height: { ideal: opts.height },
      frameRate: { ideal: opts.frameRate },
    };
    if (opts.deviceId) video.deviceId = { exact: opts.deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.attach(stream);
  }

  /** Napojí stream (z kamery alebo z vývojovej simulácie) na worker. */
  attach(stream: MediaStream): void {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Stream nemá video stopu.');
    this.stream = stream;
    this.track = track;
    track.addEventListener('ended', () => this.note('stopa kamery skončila (ended)'));
    track.addEventListener('mute', () => this.note('stopa kamery stíchla (mute)'));
    track.addEventListener('unmute', () => this.note('stopa kamery znova beží (unmute)'));
    const Processor = processorCtor();
    if (this.allowProcessor && Processor) {
      const processor = new Processor({ track, maxBufferSize: 2 });
      this.post({ type: 'stream', readable: processor.readable }, [processor.readable as unknown as Transferable]);
      this.pipeline = 'mstp';
    } else {
      this.startVideoFallback(stream);
      this.pipeline = 'video';
    }
    const s = track.getSettings();
    this.note(`štart: ${track.label || 'kamera'} ${s.width ?? '?'}×${s.height ?? '?'} @ ${s.frameRate ?? '?'} (${this.pipeline})`);
  }

  /** Znova spustí kameru s poslednými nastaveniami (napr. keď v AR neprichádzajú snímky). */
  async restart(): Promise<void> {
    if (this.lastOptions) await this.start(this.lastOptions);
  }

  stop(): void {
    this.post({ type: 'stop' });
    window.clearInterval(this.grabTimer);
    this.grabTimer = 0;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.track = null;
    this.pipeline = '';
  }

  private post(msg: ToFrameWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private startVideoFallback(stream: MediaStream): void {
    const video = this.video ?? document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch((err: unknown) => this.note(`video.play: ${String(err)}`));
    this.video = video;
    this.grabTimer = window.setInterval(() => this.grab(), 33);
  }

  private grab(): void {
    const v = this.video;
    if (!v || this.grabBusy || v.readyState < 2) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) return;
    this.grabBusy = true;
    const arrival = performance.timeOrigin + performance.now();
    const pw = Math.min(this.procWidth, w);
    createImageBitmap(v, { resizeWidth: pw, resizeHeight: Math.max(1, Math.round((pw * h) / w)), resizeQuality: 'low' })
      .then((bitmap) => this.post({ type: 'bitmap', bitmap, arrival, srcWidth: w, srcHeight: h }, [bitmap]))
      .catch((err: unknown) => this.note(`createImageBitmap: ${String(err)}`))
      .finally(() => {
        this.grabBusy = false;
      });
  }
}
