/**
 * Zdieľané geometrie, materiály a textúry (generované za behu, bez externých assetov).
 * Pokojné matné farby bez žiariacich obrysov: prekážky majú byť dobre vidieť v passthrough,
 * ale nerušiť. Výrazná je až spätná väzba (render/feedback.ts).
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  highBar: 0xe0457b,
  lowBar: 0x3cc3e0,
  cone: 0xf0702e,
  gap: 0x3ddc84,
  star: 0xf0c94a,
  stick: 0xd9534f,
  /** Spätná väzba: puk prešiel / minul. */
  hit: 0x3ddc84,
  miss: 0x9aa3ad,
};

/** Farby tímu hokejistu (dres, pruhy, helma, rukavice). */
export interface TeamColors {
  jersey: number;
  stripe: number;
  helmet: number;
  gloves: number;
}

/** Jeden obranca: červený dres (ako bočný blok). Dvojica: modrá so žltou (dvojitý blok). */
export const TEAMS: Record<'red' | 'blue', TeamColors> = {
  red: { jersey: 0xc8102e, stripe: 0xf2f2f2, helmet: 0x17191d, gloves: 0x8f0b20 },
  blue: { jersey: 0x1f4fbf, stripe: 0xffd23f, helmet: 0x1f4fbf, gloves: 0x17191d },
};

/** Päťcípa hviezda s polomerom 1, ležiaca na podlahe. */
function starGeometry(): BufferGeometry {
  const shape = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return new ShapeGeometry(shape).rotateX(-Math.PI / 2);
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

/** Geometria s jednou farbou vo vertexoch (diely hokejistu sa zlúčia do jedného meshu). */
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

const UP = new Vector3(0, 1, 0);

/** Valec od bodu a po bod b (polomer pri a a pri b). */
function limb(a: [number, number, number], b: [number, number, number], ra: number, rb: number, seg = 8): BufferGeometry {
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
  return new SphereGeometry(r, 12, 8).scale(sx, sy, sz).translate(x, y, z);
}

/**
 * Hokejista z primitív (≈1,75 m, chodidlá v počiatku, tvárou k +z, hokejka na strane +x):
 * korčule, štulpne s pruhom, nohavice, dres s pruhom a ramenami, helma s plexi, rukavice, hokejka.
 * Všetko je jeden mesh s farbami vo vertexoch (jeden draw call).
 */
function hockeyPlayerGeometry(team: TeamColors): BufferGeometry {
  const PANTS = 0x1b1d22;
  const BOOT = 0x16181c;
  const BLADE = 0xcfd6dc;
  const SKIN = 0xe0b48f;
  const VISOR = 0xb9cfe0;
  const SHAFT = 0x25282d;
  const TAPE = 0xeceff2;
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: number) => parts.push(colored(g, color));

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
  add(new CylinderGeometry(0.245, 0.215, 0.52, 12).scale(1, 1, 0.62).translate(0, 1.08, 0), team.jersey);
  add(new CylinderGeometry(0.218, 0.218, 0.05, 12).scale(1, 1, 0.63).translate(0, 0.88, 0), team.stripe);
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

  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}

export function createResources() {
  const shadowTexture = canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const fadeUpTexture = canvasTexture(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, s, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const chevronTexture = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = s * 0.07;
    ctx.lineJoin = 'round';
    for (const y of [0.3, 0.62]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.25, s * (y - 0.1));
      ctx.lineTo(s * 0.5, s * (y + 0.08));
      ctx.lineTo(s * 0.75, s * (y - 0.1));
      ctx.stroke();
    }
  });

  const solid = (color: number) => new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.22 });
  const zone = (color: number) =>
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.05, depthWrite: false, side: DoubleSide });
  const player = () => new MeshLambertMaterial({ vertexColors: true });

  return {
    geometry: {
      box: new BoxGeometry(1, 1, 1),
      plane: new PlaneGeometry(1, 1),
      floorPlane: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      rod: new CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2),
      cone: new ConeGeometry(1, 1, 14).translate(0, 0.5, 0),
      playerRed: hockeyPlayerGeometry(TEAMS.red),
      playerBlue: hockeyPlayerGeometry(TEAMS.blue),
      star: starGeometry(),
      /** Krúžok na podlahe s polomerom 1 (spätná väzba). */
      ring: new RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2),
    },
    material: {
      highBar: solid(PALETTE.highBar),
      highBarCurtain: new MeshBasicMaterial({
        color: PALETTE.highBar,
        map: fadeUpTexture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
      player: player(),
      sideBlockZone: zone(TEAMS.red.jersey),
      doubleBlockZone: zone(TEAMS.blue.jersey),
      gapWindow: new MeshBasicMaterial({
        color: PALETTE.gap,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        side: DoubleSide,
      }),
      lowBar: solid(PALETTE.lowBar),
      cone: solid(PALETTE.cone),
      gapStrip: new MeshBasicMaterial({
        color: PALETTE.gap,
        map: chevronTexture,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: DoubleSide,
      }),
      gapEdge: solid(PALETTE.gap),
      star: new MeshBasicMaterial({
        color: PALETTE.star,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: DoubleSide,
      }),
      stick: solid(PALETTE.stick),
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
