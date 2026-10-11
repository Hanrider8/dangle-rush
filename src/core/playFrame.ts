/**
 * Herný priestor: súradnice vycentrovanej plochy.
 * Počiatok je na podlahe pod hlavou v čase centrovania, −Z je smer hry, +X doprava, +Y hore.
 * Vo svete (reference space `local-floor`) je to posun (originX, 0, originZ) a otočenie o yaw okolo +Y,
 * teda presne transformácia skupiny `playRoot` v renderi.
 */
import type { HeadSample, Vec3 } from './types';
import { setVec, yawFromQuat } from './math';

export class PlayFrame {
  originX = 0;
  originZ = 0;
  yaw = 0;
  private cos = 1;
  private sin = 0;

  set(originX: number, originZ: number, yaw: number): void {
    this.originX = originX;
    this.originZ = originZ;
    this.yaw = yaw;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
  }

  /** Vycentruje plochu podľa pózy hlavy: pozícia (x, z) a otočenie len okolo zvislej osi. */
  recenter(head: HeadSample): void {
    this.set(head.px, head.pz, yawFromQuat(head.qx, head.qy, head.qz, head.qw));
  }

  /** Bod zo sveta do herného priestoru. */
  toPlayPoint(out: Vec3, x: number, y: number, z: number): Vec3 {
    const dx = x - this.originX;
    const dz = z - this.originZ;
    return setVec(out, this.cos * dx - this.sin * dz, y, this.sin * dx + this.cos * dz);
  }

  /** Smer zo sveta do herného priestoru. */
  toPlayDir(out: Vec3, x: number, y: number, z: number): Vec3 {
    return setVec(out, this.cos * x - this.sin * z, y, this.sin * x + this.cos * z);
  }

  /** Bod z herného priestoru do sveta. */
  toWorldPoint(out: Vec3, x: number, y: number, z: number): Vec3 {
    return setVec(
      out,
      this.cos * x + this.sin * z + this.originX,
      y,
      -this.sin * x + this.cos * z + this.originZ,
    );
  }

  /** Smer z herného priestoru do sveta. */
  toWorldDir(out: Vec3, x: number, y: number, z: number): Vec3 {
    return setVec(out, this.cos * x + this.sin * z, y, -this.sin * x + this.cos * z);
  }
}
