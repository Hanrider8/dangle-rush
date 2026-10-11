import { WebGLRenderer } from 'three';
import { CONFIG } from '../config';

/**
 * Renderer pre passthrough: alpha kanál a priesvitné pozadie (clear alpha 0),
 * bez shadow máp a post-processingu.
 */
export function createRenderer(container: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: CONFIG.render.antialias,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(CONFIG.render.foveation);
  container.appendChild(renderer.domElement);
  return renderer;
}
