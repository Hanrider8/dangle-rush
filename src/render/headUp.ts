/**
 * Hlava hore v renderi:
 * - TeammateView: spoluhráč ďaleko vpredu (tmavá silueta s cyan okrajom) a nad ním pulzujúca značka
 *   (krúžok s bodkou a žiarou).
 *   Kým čaká, značka pulzuje stále rýchlejšie a väčšia a spoluhráč poskakuje. Pri zachytení značka
 *   zabliká a zväčší sa. Je v playRoot (herný priestor), polohu berie zo simulácie. Kreslí sa nad tmou.
 * - Darkening: guľa okolo hlavy natočená voči svetu (nie s hlavou). Podľa eskalácie stmaví najprv podlahu
 *   a potom stále väčšiu časť zorného poľa, bliká, a okno okolo spoluhráča nechá svetlé. V passthrough tak
 *   hráč horšie vidí podlahu aj skutočný puk, kým sa nepozrie hore. Tlačidlá a HUD ostanú čitateľné.
 * Nič sa nealokuje za behu: meshe a materiály vzniknú raz, menia sa len poloha, mierka a uniformy.
 */
import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Config } from '../config';
import type { Game } from '../core/game';
import type { HeadUpDrill } from '../core/headUp';
import type { HeadSample } from '../core/types';
import { PALETTE, type Resources } from './materials';

/** Vynorenie spoluhráča z podlahy a dĺžka efektu po zachytení (s). */
const RISE_TIME = 0.25;
const SEEN_TIME = 0.45;
/** Pulzovanie značky (Hz) bez eskalácie a pri plnej eskalácii. */
const PULSE_HZ = 2.2;
const PULSE_HZ_MAX = 4.5;
/** Polomer značky (m); na 6 m je to ≈ 4° zorného poľa. */
const SIGN_RADIUS = 0.2;
/** Výška poskoku spoluhráča pri plnej eskalácii (m). */
const HOP = 0.08;
/** Spoluhráč a značka sa kreslia nad tmou (tá má renderOrder DARK_ORDER). */
const MATE_ORDER = 1600;
/**
 * Tma je nad prekážkami (renderOrder do 7), ale pod tlačidlami a HUD (9, 10, kurzor 1000+),
 * aby sa hra dala pauznúť aj v najhoršej tme.
 */
const DARK_ORDER = 8;
/** Po pohľade na spoluhráča tma zmizne za tento čas (s). */
const FADE_OUT = 0.15;

type Phase = 'hidden' | 'active' | 'seen';

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
  /** Značka (krúžok s bodkou a žiara) natočená k hráčovi. */
  private readonly sign = new Group();
  private readonly disc = new Group();
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly dot: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly halo: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly mateColor = new Color(PALETTE.mate);
  private readonly white = new Color(0xffffff);
  private phase: Phase = 'hidden';
  private id = 0;
  private time = 0;
  private pulse = 0;

  constructor(r: Resources) {
    // Vlastná (priehľadná) kópia materiálu: len tak sa spoluhráč nakreslí až po tme.
    const material = r.material.mate.clone();
    material.transparent = true;
    this.player = new Mesh(r.geometry.playerMate, material);
    this.player.renderOrder = MATE_ORDER;
    this.shadow = new Mesh(r.geometry.floorPlane, r.material.shadow);
    this.shadow.renderOrder = 3;
    this.ring = new Mesh(new RingGeometry(SIGN_RADIUS * 0.78, SIGN_RADIUS, 48), basic(PALETTE.mate));
    this.ring.renderOrder = MATE_ORDER + 2;
    this.dot = new Mesh(new CircleGeometry(SIGN_RADIUS * 0.32, 24), basic(0xffffff));
    this.dot.renderOrder = MATE_ORDER + 2;
    this.disc.add(this.ring, this.dot);
    this.halo = new Mesh(new PlaneGeometry(SIGN_RADIUS * 5, SIGN_RADIUS * 5), basic(PALETTE.mate, glowTexture()));
    this.halo.renderOrder = MATE_ORDER + 1;
    this.sign.add(this.halo, this.disc);
    this.root.add(this.shadow, this.player, this.sign);
    this.root.visible = false;
  }

  /** Udalosť zo simulácie: hráč sa pozrel na spoluhráča. */
  seen(id: number, drill: HeadUpDrill): void {
    if (id !== this.id) this.place(drill, id);
    this.phase = 'seen';
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
        this.pulse = 0;
      }
      const e = drill.escalation();
      this.time += dt;
      // V pauze značka pulzuje ďalej (je to len render), eskalácia a poskok stoja.
      this.pulse += dt * (PULSE_HZ + (PULSE_HZ_MAX - PULSE_HZ) * e);
      const p = 0.5 + 0.5 * Math.sin(this.pulse * 2 * Math.PI);
      this.rise(Math.min(1, this.time / RISE_TIME));
      this.player.position.y = HOP * e * Math.abs(Math.sin(drill.blinkPhase * Math.PI));
      this.ring.material.color.copy(this.mateColor);
      this.setSignOpacity(0.95);
      this.disc.scale.setScalar((1 + 0.6 * e) * (1 + 0.08 * p));
      this.halo.material.color.copy(this.mateColor);
      this.halo.material.opacity = 0.25 + 0.3 * p;
      this.halo.scale.setScalar((1 + 0.8 * e) * (0.9 + 0.3 * p));
      return;
    }
    if (this.phase === 'seen') {
      this.time += dt;
      const k = Math.min(1, this.time / SEEN_TIME);
      this.rise(1 - k);
      this.player.position.y = 0;
      this.ring.material.color.copy(this.mateColor).lerp(this.white, 1 - k);
      this.disc.scale.setScalar(1 + 0.9 * k);
      this.setSignOpacity(1 - k);
      this.halo.material.color.copy(this.white);
      this.halo.scale.setScalar(1.2 + 1.3 * k);
      this.halo.material.opacity = 0.9 * (1 - k);
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

  private setSignOpacity(opacity: number): void {
    this.ring.material.opacity = opacity;
    this.dot.material.opacity = opacity;
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

const darkVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Tma podľa elevácie smeru (plná pod uTop − uBand, žiadna nad uTop) okrem okna okolo spoluhráča.
const darkFragment = /* glsl */ `
  uniform float uDark;
  uniform float uTop;
  uniform float uBand;
  uniform vec3 uMateDir;
  uniform float uWindow;
  uniform float uWindowSoft;
  varying vec3 vDir;
  const float TO_DEG = 57.29577951;
  void main() {
    vec3 d = normalize(vDir);
    float el = asin(clamp(d.y, -1.0, 1.0)) * TO_DEG;
    float below = 1.0 - smoothstep(uTop - uBand, uTop, el);
    float ang = acos(clamp(dot(d, uMateDir), -1.0, 1.0)) * TO_DEG;
    float outside = smoothstep(uWindow, uWindow + uWindowSoft, ang);
    gl_FragColor = vec4(0.0, 0.0, 0.0, uDark * below * outside);
  }
`;

/**
 * Zatmavenie: guľa s polomerom 1 m okolo hlavy (natočená voči svetu), shader podľa elevácie a smeru
 * k spoluhráčovi. Kreslí sa cez prekážky (depthTest vypnutý), pod tlačidlami, HUD a spoluhráčom.
 * Bez čakajúceho spoluhráča je skrytá (nestojí fill rate).
 */
export class Darkening {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private shown = 0;
  private readonly mateWorld = new Vector3();

  constructor(private readonly cfg: Config) {
    const c = cfg.headUp;
    this.mesh = new Mesh(
      new SphereGeometry(1, 40, 28),
      new ShaderMaterial({
        vertexShader: darkVertex,
        fragmentShader: darkFragment,
        uniforms: {
          uDark: { value: 0 },
          uTop: { value: c.spreadStartDeg },
          uBand: { value: 20 },
          uMateDir: { value: new Vector3(0, 0, -1) },
          uWindow: { value: c.clearWindowDeg },
          uWindowSoft: { value: 8 },
        },
        transparent: true,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.mesh.renderOrder = DARK_ORDER;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** head = póza hlavy vo svete; playRoot prevádza polohu spoluhráča z herného priestoru do sveta. */
  update(dt: number, game: Game, head: HeadSample, playRoot: Group): void {
    const drill = game.sim.headUp;
    // V pauze a mimo hrania tma zmizne, aby bolo vidieť menu.
    const target = game.state === 'PLAYING' ? drill.darkness() * drill.blink() : 0;
    // Nábeh aj blikanie hneď, po pohľade na spoluhráča rýchle doznenie.
    this.shown = target >= this.shown ? target : Math.max(target, this.shown - (dt / FADE_OUT) * this.cfg.headUp.maxDarkness);
    if (this.shown < 0.004) {
      this.mesh.visible = false;
      return;
    }
    const u = this.mesh.material.uniforms;
    u.uDark!.value = this.shown;
    if (drill.active) {
      u.uTop!.value = drill.spread();
      this.mateWorld.set(drill.x, drill.y, drill.z);
      playRoot.localToWorld(this.mateWorld);
      (u.uMateDir!.value as Vector3).set(this.mateWorld.x - head.px, this.mateWorld.y - head.py, this.mateWorld.z - head.pz).normalize();
    }
    this.mesh.visible = true;
    this.mesh.position.set(head.px, head.py, head.pz);
  }

  /** Aktuálna sila zatmavenia (debug, testy v emulátore). */
  get opacity(): number {
    return this.shown;
  }
}
