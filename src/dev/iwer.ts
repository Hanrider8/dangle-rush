/**
 * Len pre vývoj: emulácia Questu 3 cez IWER (Immersive Web Emulation Runtime od Meta).
 * Importuje sa dynamicky iba v DEV režime, takže sa nedostane do produkčného buildu.
 *
 * Na Queste (natívne `immersive-ar`) sa emulátor neinštaluje. `?iwer=0` ho vypne, `?iwer=1` vynúti.
 */
import { XRDevice, metaQuest3 } from 'iwer';
import { DevUI } from '@iwer/devui';

export async function installIwer(): Promise<XRDevice | null> {
  const param = new URLSearchParams(window.location.search).get('iwer');
  if (param === '0') return null;
  if (param !== '1' && (await nativeImmersiveArSupported())) return null;

  const device = new XRDevice(metaQuest3);
  // Desktopový Chrome má navigator.xr aj bez headsetu, preto prepíšeme natívne API.
  device.installRuntime({ forceInstall: true });
  device.installDevUI(DevUI);
  return device;
}

async function nativeImmersiveArSupported(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-ar')) ?? false;
  } catch {
    return false;
  }
}
