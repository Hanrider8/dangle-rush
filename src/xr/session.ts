/**
 * AR session s passthrough: `immersive-ar` + `local-floor`.
 * Ruky ani ovládače nežiadame; hra pozná iba pózu hlavy.
 */
import type { WebGLRenderer } from 'three';
import { CONFIG } from '../config';

export async function isImmersiveArSupported(): Promise<boolean> {
  const xr = navigator.xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

export interface SessionHandlers {
  /** Quest menu alebo iné prekrytie: stav iný ako `visible`. */
  onVisibilityChange(state: XRVisibilityState): void;
  onEnd(): void;
  /** Systém zmenil počiatok reference space (napr. re-centrovanie cez Quest). */
  onReferenceReset(): void;
}

/** Musí sa zavolať z gesta používateľa (klik na „Spustiť“). */
export async function startArSession(
  renderer: WebGLRenderer,
  handlers: SessionHandlers,
): Promise<XRSession> {
  const xr = navigator.xr;
  if (!xr) throw new Error('WebXR nie je v tomto prehliadači dostupné.');

  const session = await xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'] });
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);
  renderer.xr.setFoveation(CONFIG.render.foveation);
  // Obnovovaciu frekvenciu nastavuje FrameRateControl až počas snímkov (xr/frameRate.ts).

  session.addEventListener('visibilitychange', () => {
    handlers.onVisibilityChange(session.visibilityState);
  });
  session.addEventListener('end', () => handlers.onEnd(), { once: true });
  renderer.xr.getReferenceSpace()?.addEventListener('reset', () => handlers.onReferenceReset());
  return session;
}
