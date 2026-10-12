/** Spoločné typy čistej hernej logiky (bez three.js a DOM). */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Póza hlavy z XR snímku v súradniciach reference space `local-floor`.
 * `valid` je false, keď póza chýba alebo má iba emulovanú pozíciu (strata trackingu).
 */
export interface HeadSample {
  valid: boolean;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export function createHeadSample(): HeadSample {
  return { valid: false, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
}

/**
 * Poloha puku z kamery v hernom priestore (na podlahe). `age` je, ako dávno kamera puk zachytila (s):
 * prekážky sa medzitým posunuli, simulácia to pri posudzovaní započíta. Bez kamery je `valid` false.
 */
export interface PuckSample {
  valid: boolean;
  x: number;
  z: number;
  age: number;
}

export function createPuckSample(): PuckSample {
  return { valid: false, x: 0, z: 0, age: 0 };
}

export type GameState = 'SETUP' | 'READY' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

/** Podpanel v stavoch READY, PAUSED a GAME_OVER (puck = kalibrácia kamery na puk). */
export type SubPanel = 'main' | 'settings' | 'recenter' | 'puck';

export type AutoPauseReason = 'visibility' | 'tracking' | 'reset' | 'sessionEnd';

export type BodyKind = 'highBar' | 'sideBlock' | 'doubleBlock';
export type FloorKind = 'lowBar' | 'coneGate' | 'slalom' | 'stars' | 'wideDangle' | 'pokeCheck';
export type ObstacleKind = BodyKind | FloorKind;

/** Obdĺžnik v priestore (panel, tlačidlo): stred, os doprava (u), os nahor (v), normála k hráčovi (n). */
export interface Rect3 {
  cx: number;
  cy: number;
  cz: number;
  ux: number;
  uy: number;
  uz: number;
  vx: number;
  vy: number;
  vz: number;
  nx: number;
  ny: number;
  nz: number;
  halfW: number;
  halfH: number;
}

export type ButtonId =
  | 'calibrate'
  | 'start'
  | 'recenter'
  | 'settings'
  | 'pause'
  | 'resume'
  | 'newGame'
  | 'set.dwell'
  | 'set.difficulty'
  | 'set.floor'
  | 'set.pausePos'
  | 'set.pauseSide'
  | 'set.countdown'
  | 'set.calibrate'
  | 'set.back'
  | 'set.debug'
  | 'set.puck'
  | 'set.fps'
  | 'puck.done';

/** puckInfo: miesto pre panel kamery pri kalibrácii puku (kreslí ho modul kamery). */
export type TextId =
  | 'setupInfo'
  | 'readyInfo'
  | 'countdown'
  | 'pausedTitle'
  | 'results'
  | 'settingsTitle'
  | 'puckInfo';
