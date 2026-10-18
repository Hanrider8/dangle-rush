/**
 * Hlava hore v renderi:
 * - TeammateView: spoluhráč ďaleko vpredu (hokejista v zelenom) a nad ním pulzujúca svietiaca značka.
 *   Krúžok okolo značky sa sťahuje podľa toho, koľko času ostáva. Pri zachytení značka zabliká a zväčší sa,
 *   pri zmeškaní zošedne. Je v playRoot (herný priestor), polohu berie zo simulácie.
 * - FloorDarkening: spodná pologuľa okolo hlavy natočená voči svetu (nie s hlavou), ktorá podľa prehľadu
 *   stmaví všetko pod horizontom. V passthrough tak hráč horšie vidí podlahu aj skutočný puk.
 * Nič sa nealokuje za behu: meshe a materiály vzniknú raz, menia sa len poloha, mierka a priehľadnosť.
 */
import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
} from 'three';
import type { Config } from '../config';
import type { Game } from '../core/game';
import type { HeadUpDrill } from '../core/headUp';
import type { HeadSample } from '../core/types';
import { PALETTE, type Resources } from './materials';

const DEG = Math.PI / 180;
/** Vynorenie spoluhráča z podlahy a dĺžka efektov po zachytení / zmeškaní (s). */
const RISE_TIME = 0.25;
const SEEN_TIME = 0.45;
const MISSED_TIME = 0.6;
/** Pulzovanie značky (Hz), aby si ju hráč všimol aj okrajom oka. */
const PULSE_HZ = 2.2;
/** Polomer značky (m); na 6 m je to ≈ 4° zorného poľa. */
const SIGN_RADIUS = 0.2;

type Phase = 'hidden' | 'active' | 'seen' | 'missed';

function glowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function basic(color: number, map: CanvasTexture | null = null): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, map, transparent: true, depthWrite: false, toneMapped: false });
}

export class TeammateView {
  readonly root = new Group();
  private readonly player: Mesh;
  private readonly shadow: Mesh;
  /** Značka (disk, žiara, krúžok s časom) natočená k hráčovi. */
  private readonly sign = new Group();
  private readonly disc: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly halo: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly timer: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly mateColor = new Color(PALETTE.mate);
  private readonly white = new Color(0xffffff);
  private readonly grey = new Color(PALETTE.miss);
  private phase: Phase = 'hidden';
  private id = 0;
  private time = 0;

  constructor(r: Resources) {
    this.player = new Mesh(r.geometry.playerMate, r.material.player);
    this.shadow = new Mesh(r.geometry.floorPlane, r.material.shadow);
    this.shadow.renderOrder = 3;
    this.disc = new Mesh(new CircleGeometry(SIGN_RADIUS, 32), basic(PALETTE.mate));
    this.disc.renderOrder = 8;
    this.halo = new Mesh(new PlaneGeometry(SIGN_RADIUS * 5, SIGN_RADIUS * 5), basic(PALETTE.mate, glowTexture()));
    this.halo.renderOrder = 7;
    this.timer = new Mesh(new RingGeometry(SIGN_RADIUS * 1.25, SIGN_RADIUS * 1.42, 48), basic(0xffffff));
    this.timer.renderOrder = 9;
    this.sign.add(this.halo, this.disc, this.timer);
    this.root.add(this.shadow, this.player, this.sign);
    this.root.visible = false;
  }

  /** Udalosť zo simulácie: hráč sa pozrel na spoluhráča (seen) alebo ho zmeškal. */
  outcome(id: number, seen: boolean, drill: HeadUpDrill): void {
    if (id !== this.id) this.place(drill, id);
    this.phase = seen ? 'seen' : 'missed';
    this.time = 0;
    this.root.visible = true;
  }

  update(dt: number, game: Game): void {
    const drill = game.sim.headUp;
    const s = game.state;
    if (s !== 'PLAYING' && s !== 'PAUSED' && s !== 'COUNTDOWN') {
      this.hide();
      return;
    }
    if (drill.active) {
      if (this.phase !== 'active' || drill.id !== this.id) {
        this.place(drill, drill.id);
        this.phase = 'active';
        this.time = 0;
      }
      this.time += dt;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * PULSE_HZ * 2 * Math.PI);
      const left = drill.showTime > 0 ? Math.max(0, 1 - drill.age / drill.showTime) : 0;
      this.rise(Math.min(1, this.time / RISE_TIME));
      this.disc.material.color.copy(this.mateColor);
      this.disc.material.opacity = 0.95;
      this.disc.scale.setScalar(1 + 0.08 * pulse);
      this.halo.material.color.copy(this.mateColor);
      this.halo.material.opacity = 0.35 + 0.4 * pulse;
      this.halo.scale.setScalar(0.9 + 0.3 * pulse);
      // Krúžok sa sťahuje k značke: keď sa jej dotkne, čas vypršal.
      this.timer.visible = true;
      this.timer.scale.setScalar(1 + 1.2 * left);
      this.timer.material.opacity = 0.85;
      return;
    }
    if (this.phase === 'seen' || this.phase === 'missed') {
      this.time += dt;
      const seen = this.phase === 'seen';
      const k = Math.min(1, this.time / (seen ? SEEN_TIME : MISSED_TIME));
      this.timer.visible = false;
      this.rise(1 - k);
      if (seen) {
        this.disc.material.color.copy(this.mateColor).lerp(this.white, 1 - k);
        this.disc.scale.setScalar(1 + 0.9 * k);
        this.disc.material.opacity = 1 - k;
        this.halo.material.color.copy(this.white);
        this.halo.scale.setScalar(1.2 + 1.3 * k);
        this.halo.material.opacity = 0.9 * (1 - k);
      } else {
        this.disc.material.color.copy(this.grey);
        this.disc.scale.setScalar(1);
        this.disc.material.opacity = 0.8 * (1 - k);
        this.halo.material.opacity = 0;
      }
      if (k >= 1) this.hide();
      return;
    }
    this.hide();
  }

  private place(drill: HeadUpDrill, id: number): void {
    this.id = id;
    // Tvárou (+z geometrie) k hráčovi v počiatku herného priestoru.
    const yaw = Math.atan2(-drill.x, -drill.z);
    this.player.position.set(drill.x, 0, drill.z);
    this.player.rotation.set(0, yaw, 0);
    this.shadow.position.set(drill.x, 0.006, drill.z);
    this.shadow.scale.set(0.9, 1, 0.7);
    this.shadow.rotation.set(0, yaw, 0);
    this.sign.position.set(drill.x, drill.y, drill.z);
    this.sign.rotation.set(0, yaw, 0);
    this.root.visible = true;
  }

  /** Spoluhráč sa vynorí z podlahy (0 = skrytý, 1 = stojí). */
  private rise(k: number): void {
    const e = k * (2 - k);
    this.player.scale.set(1, Math.max(0.001, e), 1);
    this.player.visible = e > 0.01;
    this.shadow.visible = this.player.visible;
  }

  private hide(): void {
    this.phase = 'hidden';
    this.root.visible = false;
  }
}

/**
 * Zatmavenie podlahy: pologuľa s polomerom 1 m okolo hlavy, priehľadnosť vo vertexoch podľa elevácie
 * (0 nad darkenStartDeg, 1 od darkenFullDeg). Kreslí sa cez všetko v hernom priestore (depthTest vypnutý),
 * ale pod vinietou zásahu. Mimo hrania alebo pri plnom prehľade je skrytá (nestojí fill rate).
 */
export class FloorDarkening {
  readonly mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  private shown = 0;

  constructor(private readonly cfg: Config) {
    const c = cfg.headUp;
    const geometry = new SphereGeometry(1, 36, 30, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const pos = geometry.getAttribute('position');
    const colors = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const el = Math.asin(Math.max(-1, Math.min(1, pos.getY(i)))) / DEG;
      const t = Math.max(0, Math.min(1, (c.darkenStartDeg - el) / (c.darkenStartDeg - c.darkenFullDeg)));
      colors[i * 4 + 3] = t * t * (3 - 2 * t);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.renderOrder = 1500;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(dt: number, game: Game, head: HeadSample): void {
    const target = game.state === 'PLAYING' ? this.cfg.headUp.maxDarkness * game.sim.headUp.darkness() : 0;
    // Vyhladenie: zmeškaný spoluhráč zrazí prehľad skokom, podlaha stmavne plynulo.
    this.shown += (target - this.shown) * Math.min(1, dt * 3);
    if (this.shown < 0.004) {
      this.shown = target > 0 ? this.shown : 0;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.material.opacity = this.shown;
    this.mesh.position.set(head.px, head.py, head.pz);
  }

  /** Aktuálna sila zatmavenia (debug, testy v emulátore). */
  get opacity(): number {
    return this.shown;
  }
}
