/**
 * Zdieľané geometrie, materiály a textúry (generované za behu, bez externých assetov).
 *
 * Vzhľad „športová technológia“: biela, jeden akcent (cyan) a červená len pre obrancov a zásah.
 * Pevné objekty majú unlit „holo“ materiál: farba, jemné tieňovanie podľa smeru k zemi a svetlý okraj
 * (fresnel) v akcentovej farbe. Netreba svetlá a v passthrough je tvar dobre čitateľný.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  /** Biela prekážok a textov. */
  white: 0xf2f6fa,
  /** Akcent: kadiaľ ide puk, spoluhráč, úspech. */
  accent: 0x3fd0ff,
  /** Obrancovia a zásah. */
  danger: 0xff3b4e,
  /** Tmavé diely (základne, koncovky, hokejka). */
  graphite: 0x2a3038,
  /** Minutie a neaktívne veci. */
  steel: 0x8a96a3,
  /** Spätná väzba: puk prešiel / minul. */
  hit: 0x3fd0ff,
  miss: 0x8a96a3,
  /** Hlava hore: značka spoluhráča. */
  mate: 0x3fd0ff,
};

/** Farby hokejistu (dres, pruhy, helma, rukavice). */
export interface TeamColors {
  jersey: number;
  stripe: number;
  helmet: number;
  gloves: number;
}

/** Obrancovia: tmavé siluety s červenými pruhmi. Spoluhráč (hlava hore): tmavý s cyan pruhmi a bielou helmou. */
export const TEAMS: Record<'opponent' | 'mate', TeamColors> = {
  opponent: { jersey: 0x3b424d, stripe: 0xff3b4e, helmet: 0x1e2228, gloves: 0x1e2228 },
  mate: { jersey: 0x3b424d, stripe: 0x3fd0ff, helmet: 0xe8edf2, gloves: 0x1e2228 },
};

const holoVertex = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vUp;
  void main() {
    #ifdef USE_COLOR
      vColor = color * uColor;
    #else
      vColor = uColor;
    #endif
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalMatrix * normal;
    vView = -mv.xyz;
    vUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const holoFragment = /* glsl */ `
  uniform vec3 uRimColor;
  uniform float uRimStrength;
  uniform float uRimPower;
  uniform float uShadeMin;
  uniform float uOpacity;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vUp;
  void main() {
    vec3 n = normalize(vNormal);
    float facing = abs(dot(n, normalize(vView)));
    float rim = pow(1.0 - facing, uRimPower);
    float shade = mix(uShadeMin, 1.0, dot(n, normalize(vUp)) * 0.5 + 0.5);
    gl_FragColor = vec4(vColor * shade + uRimColor * (rim * uRimStrength), uOpacity);
    #include <colorspace_fragment>
  }
`;

export interface HoloOptions {
  /** Farba okraja (fresnel) a jeho sila 0–1. */
  rim?: number;
  rimStrength?: number;
  /** Ostrosť okraja (vyššie = užší). */
  rimPower?: number;
  /** Tieňovanie: jas plôch otočených k zemi (1 = bez tieňovania). */
  shadeMin?: number;
  vertexColors?: boolean;
  opacity?: number;
}

/** Unlit materiál s okrajom (fresnel) a jemným tieňovaním; farby vo vertexoch sa násobia `color`. */
export function holoMaterial(color: number, o: HoloOptions = {}): ShaderMaterial {
  const opacity = o.opacity ?? 1;
  return new ShaderMaterial({
    vertexShader: holoVertex,
    fragmentShader: holoFragment,
    uniforms: {
      uColor: { value: new Color(color) },
      uRimColor: { value: new Color(o.rim ?? PALETTE.accent) },
      uRimStrength: { value: o.rimStrength ?? 0.5 },
      uRimPower: { value: o.rimPower ?? 2.2 },
      uShadeMin: { value: o.shadeMin ?? 0.62 },
      uOpacity: { value: opacity },
    },
    vertexColors: o.vertexColors ?? false,
    transparent: opacity < 1,
    toneMapped: false,
  });
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Geometria s jednou farbou vo vertexoch (diely sa zlúčia do jedného meshu = jeden draw call). */
function colored(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[3 * i] = c.r;
    colors[3 * i + 1] = c.g;
    colors[3 * i + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

/** Zlúči farebné diely (všetky indexované primitíva three.js) do jednej geometrie. */
function merge(parts: [BufferGeometry, number][]): BufferGeometry {
  const list = parts.map(([g, hex]) => colored(g, hex));
  const merged = mergeGeometries(list)!;
  for (const g of list) g.dispose();
  return merged;
}

/**
 * Tréningový marker (polomer základne 1, výška 1, stojí na podlahe): tmavá základňa, štíhle biele telo
 * s cyan prstencom a zaobleným vrchom. Mierka podľa coneRadius a coneHeight z configu.
 */
function markerGeometry(): BufferGeometry {
  const bodyR = (y: number) => 0.72 + ((0.18 - 0.72) * (y - 0.06)) / 0.92;
  return merge([
    [new CylinderGeometry(1.02, 1.1, 0.06, 24).translate(0, 0.03, 0), PALETTE.graphite],
    [new CylinderGeometry(0.18, 0.72, 0.92, 24).translate(0, 0.52, 0), PALETTE.white],
    [new CylinderGeometry(bodyR(0.67) * 1.05, bodyR(0.55) * 1.05, 0.12, 24).translate(0, 0.61, 0), PALETTE.accent],
    [new SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.98, 0), PALETTE.white],
  ]);
}

/** Nízka tyč (dĺžka 1 pozdĺž x, priemer 1): biele telo a tmavé koncovky. */
function barGeometry(): BufferGeometry {
  return merge([
    [new CylinderGeometry(0.5, 0.5, 0.88, 16).rotateZ(Math.PI / 2), PALETTE.white],
    [new CylinderGeometry(0.53, 0.53, 0.06, 16).rotateZ(Math.PI / 2).translate(-0.47, 0, 0), PALETTE.graphite],
    [new CylinderGeometry(0.53, 0.53, 0.06, 16).rotateZ(Math.PI / 2).translate(0.47, 0, 0), PALETTE.graphite],
  ]);
}

/** Terč na podlahe (polomer 1): biely vonkajší krúžok, cyan vnútorný a biely stred. */
function targetGeometry(): BufferGeometry {
  return merge([
    [new RingGeometry(0.84, 1, 48), PALETTE.white],
    [new RingGeometry(0.4, 0.5, 40), PALETTE.accent],
    [new CircleGeometry(0.13, 24), PALETTE.white],
  ]).rotateX(-Math.PI / 2);
}

const UP = new Vector3(0, 1, 0);

/** Valec od bodu a po bod b (polomer pri a a pri b). */
function limb(a: [number, number, number], b: [number, number, number], ra: number, rb: number, seg = 10): BufferGeometry {
  const from = new Vector3(...a);
  const dir = new Vector3(...b).sub(from);
  const len = dir.length();
  const g = new CylinderGeometry(rb, ra, len, seg);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(from.x + (b[0] - a[0]) / 2, from.y + (b[1] - a[1]) / 2, from.z + (b[2] - a[2]) / 2);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}

function ellipsoid(r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number): BufferGeometry {
  return new SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, y, z);
}

/**
 * Hokejista z primitív (≈1,75 m, chodidlá v počiatku, tvárou k +z, hokejka na strane +x):
 * korčule, štulpne s pruhom, nohavice, dres s pruhom a ramenami, helma s plexi, rukavice, hokejka.
 * Všetko je jeden mesh s farbami vo vertexoch (jeden draw call).
 */
function hockeyPlayerGeometry(team: TeamColors): BufferGeometry {
  const PANTS = 0x1e2228;
  const BOOT = 0x14171b;
  const BLADE = 0xb8c2cc;
  const SKIN = 0xc9a083;
  const VISOR = 0x9fb4c4;
  const SHAFT = 0x1e2228;
  const TAPE = 0xe8edf2;
  const parts: [BufferGeometry, number][] = [];
  const add = (g: BufferGeometry, color: number) => parts.push([g, color]);

  for (const s of [-1, 1]) {
    const x = 0.11 * s;
    add(box(0.012, 0.03, 0.3, x, 0.015, 0.03), BLADE);
    add(box(0.1, 0.12, 0.27, x, 0.09, 0.04), BOOT);
    add(limb([x, 0.15, 0], [x * 1.08, 0.5, 0.02], 0.058, 0.066), team.jersey);
    add(limb([x * 1.04, 0.34, 0.008], [x * 1.05, 0.39, 0.01], 0.067, 0.068), team.stripe);
    add(limb([x * 1.08, 0.48, 0.01], [x * 1.18, 0.8, 0], 0.1, 0.11), PANTS);
  }
  add(box(0.44, 0.12, 0.27, 0, 0.82, 0), PANTS);
  // Dres: zúžený valec sploštený do hĺbky, pruh pri spodnom okraji a ramená.
  add(new CylinderGeometry(0.245, 0.215, 0.52, 14).scale(1, 1, 0.62).translate(0, 1.08, 0), team.jersey);
  add(new CylinderGeometry(0.218, 0.218, 0.05, 14).scale(1, 1, 0.63).translate(0, 0.88, 0), team.stripe);
  for (const s of [-1, 1]) add(ellipsoid(0.13, 1, 0.75, 0.9, 0.2 * s, 1.3, 0), team.jersey);
  add(limb([0, 1.34, 0], [0, 1.43, 0.01], 0.055, 0.05), PANTS);
  // Hlava: tvár pod helmou, helma, plexi.
  add(ellipsoid(0.085, 1, 1.05, 1, 0, 1.52, 0.04), SKIN);
  add(ellipsoid(0.12, 1, 1.02, 1.12, 0, 1.57, -0.01), team.helmet);
  add(box(0.19, 0.045, 0.03, 0, 1.555, 0.115), VISOR);

  // Ruky drží hokejku vpredu: horná ruka pri tele, spodná nižšie na strane hokejky.
  const top: [number, number, number] = [0.05, 1.05, 0.3];
  const low: [number, number, number] = [0.2, 0.8, 0.38];
  add(limb([0.27, 1.27, 0], [0.33, 1.0, 0.18], 0.065, 0.058), team.jersey);
  add(limb([0.33, 1.0, 0.18], low, 0.058, 0.05), team.jersey);
  add(limb([0.315, 1.06, 0.13], [0.33, 1.0, 0.18], 0.064, 0.064), team.stripe);
  add(limb([-0.27, 1.27, 0], [-0.2, 1.08, 0.2], 0.065, 0.058), team.jersey);
  add(limb([-0.2, 1.08, 0.2], top, 0.058, 0.05), team.jersey);
  add(limb([-0.22, 1.13, 0.15], [-0.2, 1.08, 0.2], 0.064, 0.064), team.stripe);
  add(box(0.11, 0.1, 0.12, ...top), team.gloves);
  add(box(0.11, 0.1, 0.12, ...low), team.gloves);
  // Hokejka: žŕdka cez obe ruky po podlahu a čepeľ s páskou.
  const heel: [number, number, number] = [0.66, 0.04, 0.62];
  add(limb([0.02, 1.1, 0.28], heel, 0.016, 0.016, 6), SHAFT);
  add(box(0.32, 0.07, 0.018, heel[0] + 0.14, 0.035, heel[2]), TAPE);
  return merge(parts);
}

export function createResources() {
  const shadowTexture = canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const fadeUpTexture = canvasTexture(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, s, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  // Dráha pre puk: slabá výplň, ostré okraje po stranách a prerušovaná stredová čiara (u = šírka, v = dĺžka).
  const laneTexture = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    const edge = Math.round(s * 0.06);
    ctx.fillRect(0, 0, edge, s);
    ctx.fillRect(s - edge, 0, edge, s);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const line = Math.max(2, Math.round(s * 0.025));
    for (let y = s * 0.12; y < s; y += s * 0.5) ctx.fillRect(s / 2 - line / 2, y, line, s * 0.26);
  });
  // Stopa obrancu na podlahe: slabá výplň a okraj.
  const footprintTexture = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = s * 0.05;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
  });

  const flat = (color: number, opacity: number, map: CanvasTexture | null = null) =>
    new MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, side: DoubleSide });

  return {
    geometry: {
      box: new BoxGeometry(1, 1, 1),
      plane: new PlaneGeometry(1, 1),
      floorPlane: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      /** Nízka tyč s koncovkami (dĺžka 1 pozdĺž x). */
      rod: barGeometry(),
      /** Tréningový marker (namiesto kužeľa). */
      cone: markerGeometry(),
      playerOpponent: hockeyPlayerGeometry(TEAMS.opponent),
      playerMate: hockeyPlayerGeometry(TEAMS.mate),
      /** Terč na podlahe (namiesto hviezdy). */
      target: targetGeometry(),
      /** Krúžok na podlahe s polomerom 1 (spätná väzba). */
      ring: new RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2),
    },
    material: {
      highBar: holoMaterial(PALETTE.white, { rim: PALETTE.danger, rimStrength: 0.6 }),
      highBarCurtain: new MeshBasicMaterial({
        color: PALETTE.danger,
        map: fadeUpTexture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
      /** Obrancovia: tmavá silueta s červeným okrajom. */
      opponent: holoMaterial(0xffffff, { vertexColors: true, rim: PALETTE.danger, rimStrength: 0.95, rimPower: 2.0, shadeMin: 0.55 }),
      /** Spoluhráč: tmavá silueta s cyan okrajom. */
      mate: holoMaterial(0xffffff, { vertexColors: true, rim: PALETTE.accent, rimStrength: 1.0, rimPower: 2.0, shadeMin: 0.55 }),
      /** Stopa obrancu na podlahe a tenká čiara na vnútornej hrane (sem hlava nesmie). */
      footprint: flat(PALETTE.danger, 0.75, footprintTexture),
      dangerEdge: new MeshBasicMaterial({ color: PALETTE.danger, transparent: true, opacity: 0.8, depthWrite: false }),
      gapWindow: flat(PALETTE.accent, 0.06),
      gapEdge: new MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.9, depthWrite: false }),
      lowBar: holoMaterial(0xffffff, { vertexColors: true, rimStrength: 0.45 }),
      cone: holoMaterial(0xffffff, { vertexColors: true, rimStrength: 0.4 }),
      lane: flat(PALETTE.accent, 0.85, laneTexture),
      target: new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: DoubleSide,
      }),
      stick: holoMaterial(PALETTE.graphite, { rim: PALETTE.danger, rimStrength: 0.7 }),
      stickTape: holoMaterial(PALETTE.white, { rim: PALETTE.danger, rimStrength: 0.4 }),
      shadow: new MeshBasicMaterial({
        color: 0x000000,
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
      }),
    },
  };
}

export type Resources = ReturnType<typeof createResources>;
