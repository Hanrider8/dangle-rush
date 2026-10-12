/**
 * Textová správa z testu kamery pre vývoj: čo prehliadač o kamere prezradil (nastavenia, schopnosti,
 * vlastnosti snímok), ako rýchlo chodia snímky, ako sa darí hľadať puk a výsledok kalibrácie.
 * Hráč ju skopíruje alebo odfotí a pošle ďalej.
 */
import type { CamParams } from '../tracking/cameraModel';
import type { FrameStats } from './frameStats';
import type { CameraSource } from './source';
import type { PuckTracker } from './tracker';

export interface ReportContext {
  source: CameraSource;
  tracker: PuckTracker;
  requested: { width: number; height: number; frameRate: number };
  xrSessions: number;
  restarts: number;
  xr: { all: FrameStats; playing: FrameStats; noCamera: FrameStats; targetHz: number };
  version: string;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return `(chyba: ${String(err)})`;
  }
}

/** Názvy vlastností prototypu (aj neštandardné rozšírenia prehliadača). */
function protoNames(ctor: { prototype: object } | undefined): string {
  if (!ctor) return '–';
  return Object.getOwnPropertyNames(ctor.prototype)
    .filter((n) => n !== 'constructor')
    .sort()
    .join(', ');
}

function deg(rad: number): string {
  return ((rad * 180) / Math.PI).toFixed(2);
}

export function describeParams(p: CamParams): string {
  return (
    `f ${p.f.toFixed(1)} px, stred (${p.cx.toFixed(1)}; ${p.cy.toFixed(1)}), ` +
    `natočenie (${deg(p.rx)}°; ${deg(p.ry)}°; ${deg(p.rz)}°), ` +
    `poloha (${(p.tx * 100).toFixed(1)}; ${(p.ty * 100).toFixed(1)}; ${(p.tz * 100).toFixed(1)}) cm, ` +
    `oneskorenie ${p.latencyMs.toFixed(1)} ms, obraz ${p.width}×${p.height}`
  );
}

export function buildReport(c: ReportContext): string {
  const { source, tracker } = c;
  const s = tracker.stats;
  const lines: string[] = [];
  lines.push(`DangleRush – test kamery (${c.version})`);
  lines.push(`Prehliadač: ${navigator.userAgent}`);
  lines.push(`MediaStreamTrackProcessor: ${source.processorAvailable ? 'áno' : 'nie'} · cesta: ${source.pipeline || '–'}`);
  lines.push('');
  lines.push('Kamery:');
  if (source.devices.length === 0) lines.push('  (zoznam je prázdny alebo ešte nebolo povolenie)');
  const current = source.track?.getSettings().deviceId;
  for (const d of source.devices) {
    lines.push(`  ${d.deviceId === current ? '→' : '•'} ${d.label || '(bez názvu)'} [${d.deviceId.slice(0, 8)}…]`);
  }
  lines.push(`Požadované: ${c.requested.width}×${c.requested.height} @ ${c.requested.frameRate}`);
  const track = source.track;
  if (track) {
    lines.push(`Stopa: ${track.label} · stav ${track.readyState}${track.muted ? ' (muted)' : ''}`);
    lines.push(`getSettings: ${json(track.getSettings())}`);
    const caps = (track as unknown as { getCapabilities?: () => unknown }).getCapabilities?.();
    lines.push(`getCapabilities: ${json(caps ?? '–')}`);
    lines.push(`getConstraints: ${json(track.getConstraints())}`);
  } else {
    lines.push('Stopa: kamera nebeží');
  }
  // Meta píše, že web s povolením kamier dostane aj ohniskovú vzdialenosť, stred obrazu a polohu
  // kamery. Kde presne, nie je zdokumentované: hľadáme neštandardné obmedzenia a metódy.
  lines.push(`getSupportedConstraints: ${Object.keys(navigator.mediaDevices?.getSupportedConstraints?.() ?? {}).join(', ')}`);
  lines.push(`MediaStreamTrack: ${protoNames(globalThis.MediaStreamTrack)}`);
  lines.push(`VideoFrame: ${protoNames((globalThis as unknown as { VideoFrame?: { prototype: object } }).VideoFrame)}`);
  const info = tracker.frameInfo;
  if (info) {
    lines.push(
      `Snímka: ${info.format} · coded ${info.codedWidth}×${info.codedHeight} · display ${info.displayWidth}×${info.displayHeight} · rotácia ${info.rotation}`,
    );
    lines.push(`  colorSpace ${info.colorSpace}`);
    lines.push(`  metadata ${info.metadata}`);
    lines.push(`  prvá značka ${info.timestampUs} µs`);
  }
  lines.push('');
  lines.push(
    `Snímky: ${s.frames} (v AR ${s.framesInXr}) · ${s.fps.toFixed(1)} fps · spracovanie ${s.procMs.toFixed(1)} ms (${s.method || '–'}) · AR session ${c.xrSessions} · reštarty ${c.restarts}`,
  );
  lines.push(`XR snímky (cieľ ${c.xr.targetHz || '?'} Hz): ${c.xr.all.describe()}`);
  lines.push(`  počas hry: ${c.xr.playing.describe()}`);
  lines.push(`  bez kamery: ${c.xr.noCamera.describe()}`);
  const sync = tracker.sync;
  lines.push(
    `Časové značky: ${sync.usingTimestamps ? 'áno' : 'nie (čas príchodu)'} · posun ${Number.isFinite(sync.offset) ? sync.offset.toFixed(1) : '–'} ms · jitter doručenia ${sync.meanExtraDelay.toFixed(1)} ms · resety ${sync.resets}`,
  );
  lines.push(
    `Puk: nájdený v ${s.found} snímkach (${(s.foundRate * 100).toFixed(0)} % za poslednú sekundu) · premietnutý ${s.projected}× · cieľ ${tracker.target}`,
  );
  const p = tracker.puck;
  if (p.valid) {
    lines.push(
      `  posledný: pixel (${p.u.toFixed(1)}; ${p.v.toFixed(1)}) polomer ${p.radius.toFixed(1)} px (čakaný ${p.expectedRadius.toFixed(1)}) · plocha x ${p.playX.toFixed(3)} z ${p.playZ.toFixed(3)} m · rozptyl ${Number.isFinite(s.spreadCm) ? s.spreadCm.toFixed(1) : '–'} cm`,
    );
  }
  lines.push('');
  lines.push(`Kamera (${tracker.paramsSource}): ${describeParams(tracker.params)}`);
  const cal = tracker.calib;
  lines.push(`Kalibrácia: ${cal.status} · pokusy ${cal.attempts}, prijaté ${cal.accepted}`);
  const r = cal.last;
  if (r) {
    lines.push(
      `  posledný pokus: ${r.ok ? 'OK' : r.reason} · chyba ${Number.isFinite(r.rmsDeg) ? r.rmsDeg.toFixed(3) : '–'}° · body ${r.inliers}/${r.observations} · pokrytie ${(r.coverageU * 100).toFixed(0)}/${(r.coverageV * 100).toFixed(0)} % · hlava ${r.headRangeDeg.toFixed(1)}° · ${r.iterations} iterácií, ${cal.lastMs.toFixed(0)} ms`,
    );
    lines.push(`  výsledok: ${describeParams(r.params)}`);
  }
  if (source.log.length > 0) {
    lines.push('');
    lines.push('Udalosti:');
    for (const l of source.log) lines.push(`  ${l}`);
  }
  return lines.join('\n');
}
