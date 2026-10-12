/**
 * Len pre vývoj: autopilot na ukážku hry v emulátore (`?demo=1` alebo `__dr.demo(true)`).
 *
 * V reálnom čase ovláda emulovaný headset: pozerá na tlačidlá, sleduje prekážky, uhýba obrancom.
 * Kreslí aj virtuálny puk a posiela ho hre ako puk z kamery (ak kamera nebeží), takže hra prvky
 * na zemi posudzuje a ukazuje spätnú väzbu. `missOffset` puk posunie do strany (ukážka minutí).
 * Do produkčného buildu sa nedostane.
 */
import type { XRDevice } from 'iwer';
import { CylinderGeometry, Euler, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { App } from '../app';
import { CONFIG } from '../config';
import { clamp } from '../core/math';
import type { ButtonId, PuckSample } from '../core/types';

const DEG = Math.PI / 180;
/** Najväčšia rýchlosť virtuálneho puku a posunu hlavy do strany (m/s). */
const PUCK_SPEED = 1.7;
const HEAD_SPEED = 1.2;

export class DemoPilot {
  active = false;
  /** Posun virtuálneho puku do strany (m): ukážka minutí. */
  missOffset = 0;
  private ownsPuck = false;
  private readonly puck = new Group();
  private puckX = 0;
  private dribble = 0;
  private headX = 0;
  private headY = 1.5;
  /** Smer pohľadu voči smeru hry v stupňoch (+ yaw = doľava, + pitch = hore). */
  private yaw = 0;
  private pitch = -20;
  private last = -1;
  private raf = 0;
  private phase = '';
  private phaseTime = 0;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly world = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly app: App,
    private readonly device: XRDevice,
  ) {
    const body = new Mesh(new CylinderGeometry(0.038, 0.038, 0.025, 24), new MeshBasicMaterial({ color: 0x202020 }));
    body.position.y = 0.0125;
    const rim = new Mesh(new RingGeometry(0.033, 0.042, 24).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffffff }));
    rim.position.y = 0.026;
    this.puck.add(body, rim);
    this.puck.visible = false;
    app.rig.playRoot.add(this.puck);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.device.controlMode = 'programmatic';
    this.headY = this.app.game.eyeHeight;
    this.last = -1;
    if (!this.app.puckSource) {
      this.app.puckSource = this.feedPuck;
      this.ownsPuck = true;
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.puck.visible = false;
    if (this.ownsPuck) {
      this.app.puckSource = null;
      this.ownsPuck = false;
    }
  }

  /** Virtuálny puk ako puk z kamery (bez oneskorenia). */
  private readonly feedPuck = (_now: number, out: PuckSample): void => {
    out.valid = this.app.game.state === 'PLAYING';
    out.x = this.puckX + this.dribbleOffset() + this.missOffset;
    out.z = -CONFIG.playArea.centerDistance;
    out.age = 0;
  };

  private readonly loop = (t: number): void => {
    if (!this.active) return;
    const dt = this.last < 0 ? 0 : Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.update(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number): void {
    const game = this.app.game;
    if (!game.centered) return;
    const phase = `${game.state}/${game.sub}`;
    if (phase !== this.phase) {
      this.phase = phase;
      this.phaseTime = 0;
    }
    this.phaseTime += dt;
    const eye = game.eyeHeight;

    switch (game.state) {
      case 'SETUP':
        this.moveHead(0, eye, dt);
        this.aimButton('calibrate', dt);
        break;
      case 'READY':
        this.moveHead(0, eye, dt);
        if (game.sub === 'settings') this.aimButton('set.back', dt);
        else if (game.sub === 'recenter' || this.phaseTime < 1.5) this.aimDir(0, -5, dt);
        else this.aimButton('start', dt);
        break;
      case 'COUNTDOWN':
        this.moveHead(0, eye * 0.88, dt);
        this.aimDir(0, -30, dt);
        break;
      case 'PLAYING':
        this.play(dt);
        break;
      case 'PAUSED':
        // Najprv pohľad inam: tlačidlo pod pohľadom sa po aktivácii plní, až keď z neho pohľad odíde.
        this.moveHead(this.headX, eye * 0.95, dt);
        if (game.sub !== 'main') this.aimButton('set.back', dt);
        else if (this.phaseTime < 1.2) this.aimDir(0, -20, dt);
        else this.aimButton('resume', dt);
        break;
      case 'GAME_OVER':
        this.moveHead(0, eye, dt);
        if (game.sub !== 'main') this.aimButton('set.back', dt);
        else if (this.phaseTime < 4) this.aimDir(0, -2, dt);
        else this.aimButton('newGame', dt);
        break;
    }
    this.applyPose();
    this.puck.visible = game.state === 'PLAYING' || game.state === 'COUNTDOWN' || game.state === 'PAUSED';
    this.puck.position.set(this.puckX + this.dribbleOffset() + this.missOffset, 0, -CONFIG.playArea.centerDistance);
  }

  /** Hra: puk ide k najbližšej medzere na zemi, hlava uhýba obrancom, pohľad sleduje puk a dráhu. */
  private play(dt: number): void {
    const sim = this.app.game.sim;
    const ballZ = -CONFIG.playArea.centerDistance;

    let targetX = this.puckX;
    let nextZ = -Infinity;
    for (const o of sim.obstacles) {
      if (!o.active || o.body) continue;
      for (let i = 0; i < o.elemCount; i++) {
        const z = o.z + o.elemDz[i]!;
        if (z > ballZ + 0.05 || z <= nextZ) continue;
        nextZ = z;
        targetX = o.elemPuckX[i]!;
      }
    }
    const shift = targetX - this.puckX;
    this.puckX += clamp(shift, -PUCK_SPEED * dt, PUCK_SPEED * dt);
    // Kým nie je kam ísť, puk sa „mieša“ do strán; pri presune len jemne.
    this.dribble += dt * (Math.abs(shift) > 0.05 ? 14 : 9);

    let headTarget = this.puckX * 0.35;
    let duck = 0;
    for (const o of sim.obstacles) {
      if (!o.active || !o.body || o.resolved || o.z < -3.5 || o.z > 0.4) continue;
      if (o.kind === 'sideBlock') headTarget = o.side < 0 ? 0.42 : -0.42;
      else if (o.kind === 'doubleBlock') headTarget = o.gapX;
      else duck = 0.35;
    }
    this.moveHead(headTarget, this.app.game.eyeHeight * 0.86 - duck, dt);

    const lookZ = Number.isFinite(nextZ) ? Math.max(nextZ, -4) : -2.5;
    this.aimAt((this.puckX + targetX) / 2, 0, (ballZ + lookZ) / 2 - 0.4, dt);
  }

  private dribbleOffset(): number {
    const state = this.app.game.state;
    return state === 'PLAYING' ? Math.sin(this.dribble) * 0.06 : 0;
  }

  private moveHead(x: number, y: number, dt: number): void {
    this.headX += clamp(x - this.headX, -HEAD_SPEED * dt, HEAD_SPEED * dt);
    this.headY += (y - this.headY) * Math.min(1, dt * 4);
  }

  private aimDir(yawDeg: number, pitchDeg: number, dt: number): void {
    const k = Math.min(1, dt * 5);
    this.yaw += (yawDeg - this.yaw) * k;
    this.pitch += (pitchDeg - this.pitch) * k;
  }

  /** Natočí pohľad na bod v hernom priestore. */
  private aimAt(x: number, y: number, z: number, dt: number): void {
    const dx = x - this.headX;
    const dy = y - this.headY;
    const dz = z;
    this.aimDir(Math.atan2(-dx, -dz) / DEG, Math.atan2(dy, Math.hypot(dx, dz)) / DEG, dt);
  }

  private aimButton(id: ButtonId, dt: number): void {
    const b = this.app.game.layout.buttons.find((x) => x.id === id);
    if (b) this.aimAt(b.cx, b.cy, b.cz, dt);
  }

  private applyPose(): void {
    const frame = this.app.game.playFrame;
    frame.toWorldPoint(this.world, this.headX, this.headY, 0);
    this.device.position.set(this.world.x, this.world.y, this.world.z);
    this.euler.set(this.pitch * DEG, frame.yaw + this.yaw * DEG, 0, 'YXZ');
    const q = this.device.quaternion;
    // Quaternion z Euler YXZ (rovnaký vzorec ako three.js Quaternion.setFromEuler).
    const c1 = Math.cos(this.euler.x / 2);
    const c2 = Math.cos(this.euler.y / 2);
    const s1 = Math.sin(this.euler.x / 2);
    const s2 = Math.sin(this.euler.y / 2);
    q.set(s1 * c2, c1 * s2, -s1 * s2, c1 * c2);
  }
}
