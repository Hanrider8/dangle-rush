/**
 * Zdieľané geometrie, materiály a textúry (generované za behu, bez externých assetov).
 *
 * Realistický vzhľad: fyzikálne materiály (MeshStandardMaterial) s osvetlením z prostredia
 * (scene.ts, RoomEnvironment), skutočné tréningové pomôcky (oranžové kužele, čierny puk na červenom
 * bode buly, hokejka s páskou) a hokejisti v dresoch s číslami, s matnými a lesklými dielmi.
 * Kadiaľ ide puk, ukazuje jemne pulzujúca svetelná škvrna s krúžkom veľkosti puku.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  /** Vysoká tyč (v predvolenom mixe vypnutá). */
  highBar: 0xd8dde3,
  /** Hokejka na zemi (nízka tyč, poke check). */
  lowBar: 0x16171a,
  stick: 0x16171a,
  /** Tréningový kužeľ. */
  cone: 0xff5a14,
  /** Svetlo navádzania: kadiaľ ide puk. */
  gap: 0x4fc3ff,
  /** Červený bod buly pod pukom (prvok „hviezdy“). */
  star: 0xc8102e,
  puck: 0x0b0b0c,
  /** Spätná väzba: puk prešiel / minul. */
  hit: 0x3ddc84,
  miss: 0x9aa3ad,
  /** Hlava hore: značka spoluhráča. */
  mate: 0xffffff,
};

/** Farby hokejistu: dres, pruhy na drese a štulpniach, helma a rukavice, číslo. */
export interface TeamColors {
  jersey: number;
  stripe: number;
  helmet: number;
  gloves: number;
  number: string;
  numberColor: string;
  numberOutline: string;
}

/** Obrancovia: červené dresy súpera. Spoluhráč (hlava hore): biely domáci dres s tmavomodrou. */
export const TEAMS: Record<'opponent' | 'mate', TeamColors> = {
  opponent: {
    jersey: 0xb5121b,
    stripe: 0xf4f4f4,
    helmet: 0x111214,
    gloves: 0x111214,
    number: '4',
    numberColor: '#f4f4f4',
    numberOutline: '#111214',
  },
  mate: {
    jersey: 0xf2f3f5,
    stripe: 0x0b2a5c,
    helmet: 0x0b2a5c,
    gloves: 0x0b2a5c,
    number: '19',
    numberColor: '#0b2a5c',
    numberOutline: '#f2f3f5',
  },
};

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
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

/** Zlúči farebné diely (indexované primitíva three.js, bez UV) do jednej geometrie. */
function merge(parts: [BufferGeometry, number][]): BufferGeometry {
  const list = parts.map(([g, hex]) => {
    g.deleteAttribute('uv');
    return colored(g, hex);
  });
  const merged = mergeGeometries(list)!;
  for (const g of list) g.dispose();
  return merged;
}

/**
 * Tréningový kužeľ (polomer základne 1, výška 1): štvorcová základňa a zrezaný kužeľ so zaobleným
 * vrchom, všetko oranžové (základňa tmavšia). Mierka podľa coneRadius a coneHeight z configu.
 */
function coneGeometry(): BufferGeometry {
  const base = 0xd9480f;
  return merge([
    [new BoxGeometry(1.9, 0.07, 1.9).translate(0, 0.035, 0), base],
    [new CylinderGeometry(0.86, 0.9, 0.05, 28).translate(0, 0.095, 0), base],
    [new CylinderGeometry(0.13, 0.78, 0.84, 28, 1, true).translate(0, 0.54, 0), PALETTE.cone],
    [new SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.96, 0), PALETTE.cone],
  ]);
}

/**
 * Hokejka ležiaca na zemi (dĺžka 1 pozdĺž x, čepeľ na konci +x zahnutá k +z): čierna lesklá žŕdka
 * s červeno-bielym pásom, biela páska na konci rukoväte a na čepeli.
 */
function stickGeometry(): BufferGeometry {
  const BLACK = 0x16171a;
  const TAPE = 0xf2f2f2;
  const RED = 0xc8102e;
  const t = 0.022;
  const w = 0.03;
  const blade = (len: number, width: number, thick: number) =>
    new BoxGeometry(len, thick, width).translate(len / 2, 0, 0).rotateY(-0.42).translate(0.36, thick / 2, 0.005);
  return merge([
    [new BoxGeometry(0.86, t, w).translate(-0.07, t / 2, 0), BLACK],
    [new BoxGeometry(0.1, t * 1.15, w * 1.15).translate(-0.45, (t * 1.15) / 2, 0), TAPE],
    [new BoxGeometry(0.05, t * 1.08, w * 1.08).translate(-0.18, (t * 1.08) / 2, 0), RED],
    [new BoxGeometry(0.02, t * 1.08, w * 1.08).translate(-0.145, (t * 1.08) / 2, 0), TAPE],
    [blade(0.3, 0.075, 0.012), BLACK],
    [blade(0.2, 0.078, 0.015).translate(0.02, 0, 0.008), TAPE],
  ]);
}

/**
 * Puk (priemer 7,6 cm, výška 2,54 cm, stred podstavy v počiatku): čierna guma s ryhovaným bokom
 * a jemnou potlačou navrchu. Bok a vrch majú UV v jednej textúre (ľavá polovica bok, pravá vrch),
 * takže je to jeden draw call.
 */
function puckGeometry(): BufferGeometry {
  const r = 0.038;
  const h = 0.0254;
  const side = new CylinderGeometry(r, r, h, 40, 1, true).translate(0, h / 2, 0);
  const top = new CircleGeometry(r, 40).rotateX(-Math.PI / 2).translate(0, h, 0);
  const remap = (g: BufferGeometry, u0: number) => {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5);
    return g;
  };
  return mergeGeometries([remap(side, 0), remap(top, 0.5)])!;
}

/** Bod buly (polomer 1) ležiaci na podlahe. */
function spotGeometry(): BufferGeometry {
  return new CircleGeometry(1, 40).rotateX(-Math.PI / 2);
}

const UP = new Vector3(0, 1, 0);

/** Valec od bodu a po bod b (polomer pri a a pri b). */
function limb(a: [number, number, number], b: [number, number, number], ra: number, rb: number, seg = 14): BufferGeometry {
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
  return new SphereGeometry(r, 18, 12).scale(sx, sy, sz).translate(x, y, z);
}

/** Trup (dres) ako rotačné teleso: pás, hrudník s chráničmi, ramená, krk; sploštený do hĺbky. */
function torso(): BufferGeometry {
  const profile = [
    [0.0, 0.84],
    [0.215, 0.84],
    [0.232, 0.95],
    [0.255, 1.1],
    [0.27, 1.22],
    [0.255, 1.3],
    [0.19, 1.37],
    [0.08, 1.4],
    [0.0, 1.41],
  ].map(([x, y]) => new Vector2(x!, y!));
  return new LatheGeometry(profile, 28).scale(1, 1, 0.64);
}

/** Bod na úsečke a → b v podiele t. */
function along(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface PlayerGeometry {
  /** Matné diely (dres, nohavice, štulpne, rukavice, tvár). */
  matte: BufferGeometry;
  /** Lesklé diely (helma, plexi, korčule, hokejka). */
  gloss: BufferGeometry;
}

/**
 * Hokejista z primitív (≈1,78 m, chodidlá v počiatku, tvárou k +z, hokejka na strane +x): korčule
 * s nožom, štulpne s pruhmi, nohavice, dres s ramennými chráničmi a lakťami, helma s plexi, rukavice,
 * hokejka s páskou. Dve geometrie s farbami vo vertexoch (matný a lesklý materiál = dva draw cally).
 */
function hockeyPlayerGeometry(team: TeamColors): PlayerGeometry {
  const PANTS = 0x141518;
  const BOOT = 0x0f1012;
  const HOLDER = 0xe9ecef;
  const STEEL = 0xb8c0c8;
  const SKIN = 0xd2a283;
  const VISOR = 0x2a3644;
  const SHAFT = 0x16171a;
  const TAPE = 0xf2f2f2;
  const matte: [BufferGeometry, number][] = [];
  const gloss: [BufferGeometry, number][] = [];
  const m = (g: BufferGeometry, color: number) => matte.push([g, color]);
  const gl = (g: BufferGeometry, color: number) => gloss.push([g, color]);

  for (const s of [-1, 1]) {
    const x = 0.11 * s;
    // Korčuľa: nôž, držiak, topánka s jazykom.
    gl(box(0.008, 0.025, 0.3, x, 0.0125, 0.03), STEEL);
    gl(box(0.03, 0.03, 0.27, x, 0.04, 0.03), HOLDER);
    gl(box(0.1, 0.1, 0.25, x, 0.1, 0.045), BOOT);
    gl(box(0.085, 0.07, 0.06, x, 0.17, 0.15), BOOT);
    // Štulpňa (cez chránič holene) s dvoma pruhmi.
    m(limb([x, 0.16, 0.01], [x * 1.08, 0.52, 0.02], 0.06, 0.07), team.jersey);
    m(limb([x * 1.04, 0.3, 0.012], [x * 1.05, 0.335, 0.013], 0.067, 0.068), team.stripe);
    m(limb([x * 1.055, 0.375, 0.014], [x * 1.06, 0.405, 0.015], 0.068, 0.069), team.stripe);
    // Nohavice (breezers) so stehnom, pruh po boku.
    m(limb([x * 1.08, 0.5, 0.01], [x * 1.2, 0.84, 0], 0.105, 0.13), PANTS);
    m(box(0.012, 0.3, 0.05, x * 1.2 + s * 0.118, 0.68, 0), team.jersey);
  }
  m(box(0.46, 0.14, 0.28, 0, 0.85, 0), PANTS);
  m(torso(), team.jersey);
  // Pruhy na dolnom okraji dresu.
  m(new CylinderGeometry(0.222, 0.218, 0.035, 28).scale(1, 1, 0.645).translate(0, 0.92, 0), team.stripe);
  m(new CylinderGeometry(0.226, 0.222, 0.02, 28).scale(1, 1, 0.645).translate(0, 0.965, 0), team.stripe);
  // Ramenné chrániče pod dresom.
  for (const s of [-1, 1]) m(ellipsoid(0.13, 1.05, 0.72, 0.95, 0.2 * s, 1.3, 0), team.jersey);
  m(limb([0, 1.38, 0], [0, 1.46, 0.01], 0.055, 0.05), SKIN);

  // Hlava: tvár pod helmou, helma, plexi.
  m(ellipsoid(0.085, 1, 1.08, 1, 0, 1.54, 0.035), SKIN);
  gl(ellipsoid(0.123, 1, 0.98, 1.12, 0, 1.6, -0.01), team.helmet);
  gl(box(0.2, 0.05, 0.025, 0, 1.575, 0.118), VISOR);

  // Ruky drží hokejku vpredu: horná ruka pri tele, spodná nižšie na strane hokejky.
  const top: [number, number, number] = [0.05, 1.05, 0.3];
  const low: [number, number, number] = [0.2, 0.8, 0.38];
  const arm = (shoulder: [number, number, number], elbow: [number, number, number], hand: [number, number, number]) => {
    m(limb(shoulder, elbow, 0.068, 0.06), team.jersey);
    m(limb(elbow, hand, 0.06, 0.052), team.jersey);
    m(ellipsoid(0.066, 1, 1, 1, ...elbow), team.jersey);
    // Pruh na rukáve nad lakťom.
    m(limb(along(elbow, shoulder, 0.18), along(elbow, shoulder, 0.3), 0.067, 0.067), team.stripe);
    // Rukavica s manžetou.
    m(ellipsoid(0.065, 1, 0.85, 1.2, ...hand), team.gloves);
    m(limb(along(hand, elbow, 0.12), along(hand, elbow, 0.32), 0.058, 0.064), team.gloves);
  };
  arm([0.27, 1.27, 0], [0.33, 1.0, 0.18], low);
  arm([-0.27, 1.27, 0], [-0.2, 1.08, 0.2], top);
  // Hokejka: žŕdka cez obe ruky po podlahu, čepeľ s páskou.
  const heel: [number, number, number] = [0.66, 0.035, 0.62];
  gl(limb([0.02, 1.1, 0.28], heel, 0.015, 0.015, 8), SHAFT);
  gl(box(0.3, 0.07, 0.014, heel[0] + 0.13, 0.035, heel[2]), SHAFT);
  gl(box(0.18, 0.072, 0.017, heel[0] + 0.15, 0.036, heel[2]), TAPE);
  return { matte: merge(matte), gloss: merge(gloss) };
}

/**
 * Hokejista ako skupina: matné a lesklé diely a číslo na hrudi. renderOrder sa dá nastaviť
 * (spoluhráč sa kreslí až po zatmavení).
 */
export function createPlayer(geometry: PlayerGeometry, matte: Material, gloss: Material, number: Material, renderOrder = 0): Group {
  const group = new Group();
  const parts = [new Mesh(geometry.matte, matte), new Mesh(geometry.gloss, gloss)];
  const decal = new Mesh(NUMBER_PLANE, number);
  decal.position.set(0, 1.13, 0.172);
  parts.push(decal);
  for (let i = 0; i < parts.length; i++) {
    parts[i]!.renderOrder = renderOrder + (i === 2 ? 1 : 0);
    group.add(parts[i]!);
  }
  return group;
}

const NUMBER_PLANE = new PlaneGeometry(0.17, 0.17);

/** Číslo na hrudi dresu (priehľadná textúra). */
function numberTexture(team: TeamColors): CanvasTexture {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(h * 0.78)}px "Roboto Condensed", sans-serif-condensed, "Arial Narrow", Arial, sans-serif`;
    ctx.lineWidth = h * 0.08;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = team.numberOutline;
    ctx.strokeText(team.number, w / 2, h * 0.54);
    ctx.fillStyle = team.numberColor;
    ctx.fillText(team.number, w / 2, h * 0.54);
  });
}

export function createResources() {
  const shadowTexture = canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.7)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  const fadeUpTexture = canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  // Navádzanie puku: mäkká svetelná škvrna na zemi a v nej výrazný krúžok s tenkým tmavým lemom,
  // aby bol vidieť na svetlej aj tmavej podlahe (biele pixely zafarbí farba materiálu, čierne ostanú tmavé).
  const guideTexture = canvasTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(255,255,255,0.5)');
    glow.addColorStop(0.4, 'rgba(255,255,255,0.3)');
    glow.addColorStop(0.75, 'rgba(255,255,255,0.08)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, w);
    const ring = (radius: number, width: number, style: string) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(w * 0.2, w * 0.06, 'rgba(0,0,0,0.35)');
    ring(w * 0.2, w * 0.035, 'rgba(255,255,255,1)');
  });
  // Puk: vľavo ryhovaný bok, vpravo vrch s jemnou potlačou (kruh a text).
  const puckTexture = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a2b30';
    ctx.lineWidth = 2;
    for (let x = 2; x < w / 2; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.18);
      ctx.lineTo(x, h * 0.82);
      ctx.stroke();
    }
    const cx = w * 0.75;
    const cy = h / 2;
    ctx.strokeStyle = 'rgba(160, 165, 172, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, h * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(170, 175, 182, 0.6)';
    ctx.font = `700 ${Math.round(h * 0.12)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OFFICIAL', cx, cy - h * 0.06);
    ctx.fillText('GAME PUCK', cx, cy + h * 0.08);
  });

  const number = (team: TeamColors) =>
    new MeshStandardMaterial({ map: numberTexture(team), transparent: true, roughness: 0.85, depthWrite: false, alphaTest: 0.05 });
  const zone = () => new MeshBasicMaterial({ color: 0xc8102e, transparent: true, opacity: 0.035, depthWrite: false, side: DoubleSide });
  const shiny = () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 });

  return {
    geometry: {
      box: new BoxGeometry(1, 1, 1),
      plane: new PlaneGeometry(1, 1),
      floorPlane: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      /** Jednoduchý valec (vysoká tyč a jej duch). */
      rod: new CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2),
      cone: coneGeometry(),
      stick: stickGeometry(),
      puck: puckGeometry(),
      /** Bod buly pod pukom; aj duch prvku pri spätnej väzbe. */
      star: spotGeometry(),
      playerOpponent: hockeyPlayerGeometry(TEAMS.opponent),
      playerMate: hockeyPlayerGeometry(TEAMS.mate),
      /** Krúžok na podlahe s polomerom 1 (spätná väzba). */
      ring: new RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2),
    },
    material: {
      highBar: new MeshStandardMaterial({ color: PALETTE.highBar, roughness: 0.35, metalness: 0.6 }),
      highBarCurtain: new MeshBasicMaterial({
        color: 0xc8102e,
        map: fadeUpTexture,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
      /** Hokejista: matné a lesklé diely (farby vo vertexoch), číslo na hrudi. */
      playerMatte: new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
      playerGloss: new MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.15 }),
      numberOpponent: number(TEAMS.opponent),
      numberMate: number(TEAMS.mate),
      sideBlockZone: zone(),
      doubleBlockZone: zone(),
      gapWindow: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false, side: DoubleSide }),
      gapEdge: new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
      lowBar: shiny(),
      cone: new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
      /** Navádzanie puku: svetelná škvrna s krúžkom (jemne pulzuje, obstacleViews.ts). */
      guide: new MeshBasicMaterial({
        color: PALETTE.gap,
        map: guideTexture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
      star: new MeshBasicMaterial({ color: PALETTE.star, transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide }),
      puck: new MeshStandardMaterial({ map: puckTexture, roughness: 0.6, metalness: 0 }),
      stick: shiny(),
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
