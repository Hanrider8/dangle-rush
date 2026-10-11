/**
 * Len pre vývoj: window.__dr na skriptované testy v emulátore (prehliadač bez headsetu).
 * Ovláda emulovaný headset IWER a číta stav hry.
 */
import type { XRDevice } from 'iwer';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { App } from '../app';
import { CONFIG } from '../config';
import {
  makeConeGate,
  makeDoubleBlock,
  makeHighBar,
  makeLowBar,
  makePokeCheck,
  makeSideBlock,
  makeSlalom,
  makeStars,
  makeWideDangle,
} from '../core/obstacles';
import type { ButtonId, ObstacleKind } from '../core/types';
import { DemoPilot } from './demo';

export function installHooks(app: App, device: XRDevice | null): void {
  const game = app.game;
  const pilot = device ? new DemoPilot(app, device) : null;
  const eye = new Vector3();
  const target = new Vector3();
  const up = new Vector3(0, 1, 0);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, 'YXZ');

  const setQuat = (quat: Quaternion): void => {
    if (!device) throw new Error('IWER nie je aktívny');
    device.controlMode = 'programmatic';
    device.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  };

  app.devLog = [];
  const api = {
    app,
    /** Vráti a vyprázdni záznam udalostí. */
    log: (): string[] => app.devLog!.splice(0),
    game,
    device,
    get state() {
      return game.state;
    },
    get sub() {
      return game.sub;
    },
    get layout() {
      return game.layout.id;
    },
    buttons: () => game.layout.buttons.map((b) => b.id),
    /** Natočí headset na stred tlačidla. */
    lookAt(id: ButtonId): boolean {
      const b = game.layout.buttons.find((x) => x.id === id) ?? game.layout.inactive.find((x) => x.id === id);
      if (!b || !device) return false;
      const w = game.playFrame.toWorldPoint({ x: 0, y: 0, z: 0 }, b.cx, b.cy, b.cz);
      eye.set(device.position.x, device.position.y, device.position.z);
      target.set(w.x, w.y, w.z);
      m.lookAt(eye, target, up);
      setQuat(q.setFromRotationMatrix(m));
      return true;
    },
    /** Natočí headset: yaw a sklon v stupňoch voči smeru hry (+ yaw = doľava). */
    look(yawDeg: number, pitchDeg: number): void {
      e.set((pitchDeg * Math.PI) / 180, game.playFrame.yaw + (yawDeg * Math.PI) / 180, 0, 'YXZ');
      setQuat(q.setFromEuler(e));
    },
    /** Presunie headset (súradnice sveta, výška v metroch). */
    moveTo(x: number, y: number, z: number): void {
      if (!device) throw new Error('IWER nie je aktívny');
      device.controlMode = 'programmatic';
      device.position.set(x, y, z);
    },
    trackingLoss(on: boolean): void {
      app.simulateTrackingLoss = on;
    },
    /**
     * Posunie hru o `seconds` s pózou headsetu z IWER, bez čakania na snímky
     * (skrytý panel prehliadača vykresľuje len ~1 snímok za sekundu).
     */
    advance(seconds: number, dt = 1 / 90): string {
      if (!device) throw new Error('IWER nie je aktívny');
      const h = app.head;
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        h.valid = true;
        h.px = device.position.x;
        h.py = device.position.y;
        h.pz = device.position.z;
        h.qx = device.quaternion.x;
        h.qy = device.quaternion.y;
        h.qz = device.quaternion.z;
        h.qw = device.quaternion.w;
        app.tick(dt);
      }
      return game.state;
    },
    snapshot: () => game.sim.snapshot(),
    /** Položí konkrétnu prekážku (na vizuálnu kontrolu); automatický spawn sa zastaví. */
    place(kind: ObstacleKind, z: number, param = -1): number {
      const sim = game.sim;
      const o = sim.obstacles.find((x) => !x.active);
      if (!o) return -1;
      if (kind === 'highBar') makeHighBar(o, sim.eyeHeight, CONFIG);
      else if (kind === 'sideBlock') makeSideBlock(o, param, sim.eyeHeight, CONFIG);
      else if (kind === 'doubleBlock') makeDoubleBlock(o, param, sim.eyeHeight, CONFIG);
      else if (kind === 'lowBar') makeLowBar(o, param, 0.6, CONFIG);
      else if (kind === 'slalom') makeSlalom(o, 4, 0, param, 1.3, CONFIG);
      else if (kind === 'stars') makeStars(o, [-0.6, -0.1, 0.4], 3, 1.1, CONFIG);
      else if (kind === 'wideDangle') makeWideDangle(o, param, 1.8, CONFIG);
      else if (kind === 'pokeCheck') makePokeCheck(o, param, 0.55, z - 0.5, z + 2, CONFIG);
      else makeConeGate(o, param, CONFIG);
      o.active = true;
      o.resolved = false;
      o.hit = false;
      o.id = 100000 + Math.floor(Math.random() * 100000);
      o.z = o.prevZ = z;
      sim.spawnPause = 1e9;
      return o.id;
    },
    /** Zapne alebo vypne autopilota (ukážka hry s virtuálnym pukom). */
    demo(on = true): boolean {
      if (!pilot) return false;
      if (on) pilot.start();
      else pilot.stop();
      return pilot.active;
    },
    /** Odstráni všetky prekážky. */
    clearObstacles(): void {
      for (const o of game.sim.obstacles) o.active = false;
    },
  };
  (window as unknown as Record<string, unknown>).__dr = api;
}
