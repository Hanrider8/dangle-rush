/**
 * Hlava hore: spoluhráč nad horizontom a prehľad hráča.
 *
 * - Prehľad (0–1) s hlavou dole klesá a pri pohľade hore (sklon nad upPitchDeg) sa dopĺňa.
 * - Občas sa ďaleko vpredu objaví spoluhráč (značka mierne nad horizontom). Pohľad naňho do showTime
 *   ho zachytí: body a plný prehľad. Inak je zmeškaný a prehľad klesne o missPenalty.
 * - Pri pohľade hore kamera stratí puk, preto spoluhráč príde v medzere medzi prvkami na zemi
 *   (freeTime ≥ clearTime), najneskôr maxWait po termíne.
 * - Pod prehľadom darkenBelow tmavne podlaha (kreslí ju render/headUp.ts).
 *
 * Krokuje sa len v PLAYING (v GameplaySim), takže pauza ho zmrazí. Náhoda ide len z vlastného
 * seedovaného Rng, takže spawner dostane rovnakú postupnosť vĺn ako bez tohto režimu.
 */
import type { Config } from '../config';
import type { EventQueue } from './events';
import { DEG, clamp, lerp } from './math';
import { Rng } from './rng';
import type { Vec3 } from './types';

/** Výsledok kroku: nič, spoluhráč zachytený, spoluhráč zmeškaný. */
export const SIGNAL_NONE = 0;
export const SIGNAL_SEEN = 1;
export const SIGNAL_MISSED = 2;

/** Odvodenie seedu, aby sa náhoda spoluhráča nemiešala s náhodou spawnera. */
const SEED_SALT = 0x5bd1e995;

export class HeadUpDrill {
  enabled = false;
  /** Prehľad 0–1 (1 = hráč pravidelne dvíha hlavu). */
  awareness = 1;
  /** Spoluhráč čaká na pohľad. */
  active = false;
  /** Poradové číslo spoluhráča (n v udalostiach). */
  id = 0;
  /** Značka v hernom priestore a jej azimut (+ doprava). */
  x = 0;
  y = 0;
  z = 0;
  azDeg = 0;
  /** Ako dlho už spoluhráč čaká a ako dlho bude. */
  age = 0;
  showTime = 0;
  /** Ako dlho je pohľad súvisle na značke. */
  lookHeld = 0;
  /** Herný čas, odkedy môže prísť ďalší spoluhráč. */
  nextAt = 0;
  seen = 0;
  missed = 0;

  private rng = new Rng(SEED_SALT);
  private readonly cosLook: number;

  constructor(
    private readonly cfg: Config,
    private readonly events: EventQueue,
  ) {
    this.cosLook = Math.cos(cfg.headUp.lookAngleDeg * DEG);
  }

  get rngState(): number {
    return this.rng.state;
  }

  reset(seed: number, enabled: boolean): void {
    this.enabled = enabled;
    this.awareness = 1;
    this.active = false;
    this.id = 0;
    this.age = 0;
    this.showTime = 0;
    this.lookHeld = 0;
    this.nextAt = this.cfg.headUp.firstDelay;
    this.seen = 0;
    this.missed = 0;
    this.rng = new Rng((seed ^ SEED_SALT) >>> 0);
  }

  /** Zapnutie alebo vypnutie počas hry (nastavenia). Vypnutím zmizne aj čakajúci spoluhráč. */
  setEnabled(on: boolean, time: number): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.active = false;
    this.awareness = 1;
    this.nextAt = time + this.cfg.headUp.firstDelay;
  }

  /** Čaká sa na medzeru medzi prvkami na zemi (simulácia vtedy spočíta freeTime). */
  waiting(time: number): boolean {
    return this.enabled && !this.active && time >= this.nextAt;
  }

  /**
   * Jeden krok. head a fwd sú poloha a jednotkový smer pohľadu v hernom priestore, freeTime je čas,
   * za ktorý príde k čiare puku najbližší prvok na zemi (∞, ak žiadny). Vráti SIGNAL_*.
   */
  step(dt: number, time: number, level: number, eyeHeight: number, head: Vec3, fwd: Vec3, freeTime: number): number {
    if (!this.enabled) return SIGNAL_NONE;
    const c = this.cfg.headUp;
    const pitch = Math.asin(clamp(fwd.y, -1, 1)) / DEG;
    if (pitch > c.upPitchDeg) this.awareness = Math.min(1, this.awareness + c.refillPerSecond * dt);
    else this.awareness = Math.max(0, this.awareness - c.drainPerSecond * dt);

    if (!this.active) {
      if (time >= this.nextAt && (freeTime >= c.clearTime || time - this.nextAt >= c.maxWait)) {
        this.show(level, eyeHeight, this.rng.sign() * this.rng.range(c.azimuthMinDeg, c.azimuthMaxDeg));
      }
      return SIGNAL_NONE;
    }

    this.age += dt;
    const wx = this.x - head.x;
    const wy = this.y - head.y;
    const wz = this.z - head.z;
    const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const cos = len > 1e-9 ? (fwd.x * wx + fwd.y * wy + fwd.z * wz) / len : 1;
    if (cos >= this.cosLook) {
      this.lookHeld += dt;
      if (this.lookHeld >= c.lookTime - 1e-9) {
        this.seen++;
        this.awareness = 1;
        this.finish(time);
        this.events.push('signalSeen', '', this.id);
        return SIGNAL_SEEN;
      }
    } else {
      this.lookHeld = 0;
    }
    if (this.age >= this.showTime - 1e-9) {
      this.missed++;
      this.awareness = Math.max(0, this.awareness - c.missPenalty);
      this.finish(time);
      this.events.push('signalMissed', '', this.id);
      return SIGNAL_MISSED;
    }
    return SIGNAL_NONE;
  }

  /** Spoluhráč s azimutom azDeg (+ doprava); volá ho step, vo vývoji aj __dr.signal. */
  show(level: number, eyeHeight: number, azDeg: number): void {
    const c = this.cfg.headUp;
    this.id++;
    this.active = true;
    this.age = 0;
    this.lookHeld = 0;
    this.azDeg = azDeg;
    this.showTime = lerp(c.showTimeMax, c.showTimeMin, clamp(level, 0, 1));
    const az = azDeg * DEG;
    this.x = Math.sin(az) * c.distance;
    this.y = eyeHeight + c.distance * Math.tan(c.elevationDeg * DEG);
    this.z = -Math.cos(az) * c.distance;
    this.events.push('signal', '', this.id);
  }

  /** Sila zatmavenia podlahy 0–1: 0 nad prehľadom darkenBelow, plynulo až po 1 pri nulovom prehľade. */
  darkness(): number {
    if (!this.enabled) return 0;
    const below = this.cfg.headUp.darkenBelow;
    const t = clamp((below - this.awareness) / below, 0, 1);
    return t * t * (3 - 2 * t);
  }

  private finish(time: number): void {
    this.active = false;
    this.nextAt = time + this.rng.range(this.cfg.headUp.intervalMin, this.cfg.headUp.intervalMax);
  }
}
