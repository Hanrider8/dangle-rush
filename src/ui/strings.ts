/** Všetky texty v hre (po slovensky). */
import type { Difficulty, PausePosition, PauseSide } from '../core/settings';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  warmup: 'rozcvička',
  easy: 'ľahká',
  medium: 'stredná',
  hard: 'ťažká',
  pro: 'pro',
};

export const PAUSE_SIDE_LABEL: Record<PauseSide, string> = { left: 'vľavo', right: 'vpravo' };
export const PAUSE_POSITION_LABEL: Record<PausePosition, string> = { side: 'bok', top: 'hore' };

export const STRINGS = {
  buttons: {
    calibrate: 'Kalibrovať',
    start: 'Štart',
    recenter: 'Vycentrovať',
    settings: 'Nastavenia',
    pause: 'Pauza',
    resume: 'Pokračovať',
    newGame: 'Nová hra',
    back: 'Späť',
    done: 'Hotovo',
  },
  setup: {
    title: 'Kalibrácia výšky',
    hint: 'Postav sa vzpriamene a pozri sa na tlačidlo.',
    error: 'Výška hlavy je mimo rozsahu. Postav sa vzpriamene a skús znova.',
  },
  ready: {
    title: 'DangleRush',
    hint: 'Polož puk do stredu plochy. Tlačidlo aktivuješ pohľadom.',
    best: 'Rekord',
  },
  paused: {
    title: 'Pauza',
    reasons: {
      button: '',
      visibility: 'Hra sa zastavila (Quest menu).',
      tracking: 'Hra sa zastavila (stratený tracking).',
      reset: 'Hra sa zastavila (zmena priestoru).',
      sessionEnd: 'Hra sa zastavila.',
    },
  },
  gameOver: {
    title: 'Koniec hry',
    newBest: 'Nový rekord!',
    score: 'Skóre',
    time: 'Čas',
    maxCombo: 'Max combo',
    body: 'Prekážky pre telo',
    floor: 'Prekážky na zemi',
    headUp: 'Hlava hore',
    best: 'Rekord',
  },
  settings: {
    title: 'Nastavenia',
    dwell: 'Čas pohľadu',
    difficulty: 'Obtiažnosť',
    floor: 'Prekážky na zemi',
    headUp: 'Hlava hore',
    pausePos: 'Poloha pauzy',
    pauseSide: 'Strana pauzy',
    countdown: 'Odpočet',
    calibrate: 'Nová kalibrácia',
    calibrateValue: 'výšky hlavy',
    puck: 'Kalibrácia puku',
    fps: 'Snímky',
    puckValue: 'kamera',
    debug: 'Debug',
    on: 'zap',
    off: 'vyp',
  },
  recenter: {
    title: 'Vycentrovať',
    hint: 'Postav sa do stredu a pozri sa smerom hry.',
  },
  countdown: { go: 'Hraj!' },
  hud: {
    score: 'Skóre',
    combo: 'Combo',
    time: 'Čas',
    puck: 'Puk',
    paused: 'PAUZA',
    menuLeft: '← menu vľavo',
    menuRight: 'menu vpravo →',
    menuUp: '↑ menu hore',
  },
};

/** 1,2 s – slovenská desatinná čiarka. */
export function formatSeconds(seconds: number, decimals = 1): string {
  return `${seconds.toFixed(decimals).replace('.', ',')} s`;
}

/** 1:23 */
export function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 12 340 (medzera ako oddeľovač tisícov). */
export function formatScore(score: number): string {
  return String(Math.floor(score)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
