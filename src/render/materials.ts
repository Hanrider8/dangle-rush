/**
 * Zdieľané geometrie, materiály a textúry (generované za behu, bez externých assetov).
 * Výrazné farby a svietiace okraje, aby boli prekážky dobre viditeľné v passthrough.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  highBar: 0xff2d78,
  sideBlock: 0xff8a1f,
  doubleBlock: 0xffb81f,
  lowBar: 0x22e3ff,
  cone: 0xff5a1a,
  gap: 0x2bff88,
  star: 0xffd84d,
  stick: 0xff3b3b,
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

/** Defender pre bočný blok, postavený pre výšku 1,75 m s chodidlami v počiatku. */
function defenderGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z = 0, rotZ = 0) => {
    const g = new BoxGeometry(w, h, d);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(x, y, z);
    parts.push(g);
  };
  box(0.15, 0.78, 0.17, -0.12, 0.39);
  box(0.15, 0.78, 0.17, 0.12, 0.39);
  box(0.46, 0.62, 0.27, 0, 1.08);
  box(0.62, 0.15, 0.31, 0, 1.4);
  box(0.12, 0.5, 0.12, -0.33, 1.15);
  box(0.12, 0.5, 0.12, 0.33, 1.15);
  box(0.035, 1.35, 0.035, 0.52, 0.55, 0.05, 0.42); // hokejka
  const helmet = new SphereGeometry(0.135, 12, 8);
  helmet.translate(0, 1.6, 0);
  parts.push(helmet);
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}

export function createResources() {
  const shadowTexture = canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const fadeUpTexture = canvasTexture(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, s, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const chevronTexture = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = s * 0.09;
    ctx.lineJoin = 'round';
    for (const y of [0.3, 0.62]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.22, s * (y - 0.12));
      ctx.lineTo(s * 0.5, s * (y + 0.1));
      ctx.lineTo(s * 0.78, s * (y - 0.12));
      ctx.stroke();
    }
    ctx.strokeRect(0, 0, s, s);
  });

  const solid = (color: number) =>
    new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 });
  const rim = (color: number) =>
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      side: BackSide,
      depthWrite: false,
    });
  const zone = (color: number) =>
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });

  return {
    geometry: {
      box: new BoxGeometry(1, 1, 1),
      plane: new PlaneGeometry(1, 1),
      floorPlane: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      rod: new CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2),
      cone: new ConeGeometry(1, 1, 14).translate(0, 0.5, 0),
      defender: defenderGeometry(),
      star: starGeometry(),
      beam: new CylinderGeometry(0.5, 0.5, 1, 12, 1, true).translate(0, 0.5, 0),
    },
    material: {
      highBar: solid(PALETTE.highBar),
      highBarRim: rim(PALETTE.highBar),
      highBarCurtain: new MeshBasicMaterial({
        color: PALETTE.highBar,
        map: fadeUpTexture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
      sideBlock: solid(PALETTE.sideBlock),
      sideBlockRim: rim(PALETTE.sideBlock),
      sideBlockZone: zone(PALETTE.sideBlock),
      doubleBlock: solid(PALETTE.doubleBlock),
      doubleBlockRim: rim(PALETTE.doubleBlock),
      doubleBlockZone: zone(PALETTE.doubleBlock),
      gapWindow: new MeshBasicMaterial({
        color: PALETTE.gap,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: DoubleSide,
      }),
      lowBar: solid(PALETTE.lowBar),
      lowBarRim: rim(PALETTE.lowBar),
      cone: solid(PALETTE.cone),
      coneRim: rim(PALETTE.cone),
      gapStrip: new MeshBasicMaterial({
        color: PALETTE.gap,
        map: chevronTexture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: DoubleSide,
      }),
      gapEdge: solid(PALETTE.gap),
      star: new MeshBasicMaterial({ color: PALETTE.star, side: DoubleSide, toneMapped: false }),
      starBeam: new MeshBasicMaterial({
        color: PALETTE.star,
        map: fadeUpTexture,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
      stick: solid(PALETTE.stick),
      stickRim: rim(PALETTE.stick),
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
