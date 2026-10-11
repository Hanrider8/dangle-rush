/**
 * Vstupný bod: úvodná stránka s tlačidlom „Spustiť“. WebXR vyžaduje na otvorenie AR session
 * gesto používateľa, preto je to jediný vstup z ovládača v celej hre.
 */
import { App } from './app';
import { MemoryStorage, type KeyValueStorage } from './core/settings';
import { isImmersiveArSupported } from './xr/session';

/** localStorage, alebo pamäť, ak je úložisko zablokované (súkromné okno, náhľad). */
function safeStorage(): KeyValueStorage {
  try {
    const storage = window.localStorage;
    const probe = '__dangleRush_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return new MemoryStorage();
  }
}

async function main(): Promise<void> {
  const button = document.getElementById('start') as HTMLButtonElement;
  const status = document.getElementById('status') as HTMLParagraphElement;
  const container = document.getElementById('app') as HTMLDivElement;

  const showStatus = (text: string, error = false): void => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  let device: Awaited<ReturnType<typeof import('./dev/iwer').installIwer>> = null;
  if (import.meta.env.DEV) {
    const { installIwer } = await import('./dev/iwer');
    device = await installIwer();
  }

  const app = new App(container, safeStorage());
  if (new URLSearchParams(window.location.search).get('debug') === '1') app.game.settings.debug = true;

  if (import.meta.env.DEV) {
    const { installHooks } = await import('./dev/hooks');
    installHooks(app, device);
  }

  if (!(await isImmersiveArSupported())) {
    showStatus(
      'Tento prehliadač nepodporuje WebXR AR (immersive-ar). Otvor stránku v Meta Quest Browseri cez HTTPS alebo http://localhost.',
      true,
    );
    return;
  }

  button.disabled = false;
  showStatus('Pripravené. Klikni ovládačom na Spustiť.');

  button.addEventListener('click', () => {
    button.disabled = true;
    showStatus('Spúšťam AR…');
    app.start().then(
      () => showStatus(''),
      (err: unknown) => {
        button.disabled = false;
        showStatus(`AR sa nepodarilo spustiť: ${err instanceof Error ? err.message : String(err)}`, true);
      },
    );
  });

  app.onSessionEnd = () => {
    button.disabled = false;
    button.textContent = 'Pokračovať';
    showStatus('Hra je pozastavená. Klikni na Pokračovať.');
  };
}

void main();
