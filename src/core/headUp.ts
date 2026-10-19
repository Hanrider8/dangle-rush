/**
 * Hlava hore: spoluhráč nad horizontom, ktorý čaká, kým sa naňho hráč pozrie.
 *
 * - Občas sa ďaleko vpredu objaví spoluhráč (značka mierne nad horizontom) a čaká, kým sa naňho hráč
 *   pozrie. Nezmizne sám.
 * - Kým čaká, hra hráča stále viac „šikanuje“: po graceTime začne rásť eskalácia (0–1 za escalateTime).
 *   Podľa nej tmavne obraz, tma sa šíri od podlahy nahor, bliká stále rýchlejšie a ozýva sa čoraz
 *   naliehavejšie pripomenutie (udalosť signalNag). Okno okolo spoluhráča ostane svetlé (render).
 * - Pohľad naňho vráti všetko do normálu a dá body (neskorý pohľad menej) a combo.
 * - Pri pohľade hore kamera stratí puk, preto spoluhráč príde v medzere medzi prvkami na zemi
 *   (freeTime ≥ clearTime), najneskôr maxWait po termíne.
 *
 * Krokuje sa len v PLAYING (v GameplaySim), takže pauza ho zmrazí: eskalácia, blikanie aj pripomenutia
 * závisia len od herného času. Náhoda ide len z vlastného seedovaného Rng, takže spawner dostane
 * rovnakú postupnosť vĺn ako bez tohto režimu.
 */
import type { Config } from '../config';
import type { EventQueue } from './events';
import { DEG, clamp, lerp } from './math';
import { Rng } from './rng';
import type { Vec3 } from './types';

/** Výsledok kroku: nič alebo spoluhráč zachytený. */
export const SIGNAL_NONE = 0;
export const SIGNAL_SEEN = 1;

/** Odvodenie seedu, aby sa náhoda spoluhráča nemiešala s náhodou spawnera. */
const SEED_SALT = 0x5bd1e995;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class HeadUpDrill {
  enabled = false;
  /** Spoluhráč čaká na pohľad. */
  active = false;
  /** Poradové číslo spoluhráča (n v udalostiach). */
  id = 0;
  /** Značka v hernom priestore a jej azimut (+ doprava). */
  x = 0;
  y = 0;
  z = 0;
  azDeg = 0;
  /** Ako dlho už spoluhráč čaká. */
  age = 0;
  /** Ako dlho je pohľad súvisle na značke. */
  lookHeld = 0;
  /** Herný čas, odkedy môže prísť ďalší spoluhráč. */
  nextAt = 0;
  /** Fáza blikania (0–1); rastie s frekvenciou podľa eskalácie. */
  blinkPhase = 0;
  /** Pri akom veku spoluhráča zaznie ďalšie pripomenutie. */
  nagAt = 0;
  seen = 0;
  /** Súčet časov, kým sa hráč pozrel (priemerná reakcia = reactionSum / seen). */
  reactionSum = 0;
  /** Násobok bodov za posledného zachyteného (1 = včas, menej = neskoro). */
  lastFactor = 1;

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
    this.active = false;
    this.id = 0;
    this.age = 0;
    this.lookHeld = 0;
    this.nextAt = this.cfg.headUp.firstDelay;
    this.blinkPhase = 0;
    this.nagAt = 0;
    this.seen = 0;
    this.reactionSum = 0;
    this.lastFactor = 1;
    this.rng = new Rng((seed ^ SEED_SALT) >>> 0);
  }

  /** Zapnutie alebo vypnutie počas hry (nastavenia). Vypnutím zmizne aj čakajúci spoluhráč. */
  setEnabled(on: boolean, time: number): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.active = false;
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
  step(dt: number, time: number, eyeHeight: number, head: Vec3, fwd: Vec3, freeTime: number): number {
    if (!this.enabled) return SIGNAL_NONE;
    const c = this.cfg.headUp;

    if (!this.active) {
      if (time >= this.nextAt && (freeTime >= c.clearTime || time - this.nextAt >= c.maxWait)) {
        this.show(eyeHeight, this.rng.sign() * this.rng.range(c.azimuthMinDeg, c.azimuthMaxDeg));
      }
      return SIGNAL_NONE;
    }

    this.age += dt;
    const e = this.escalation();
    this.blinkPhase += dt * lerp(c.blinkHzMin, c.blinkHzMax, e);
    if (this.blinkPhase >= 1) this.blinkPhase -= Math.floor(this.blinkPhase);

    const wx = this.x - head.x;
    const wy = this.y - head.y;
    const wz = this.z - head.z;
    const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const cos = len > 1e-9 ? (fwd.x * wx + fwd.y * wy + fwd.z * wz) / len : 1;
    if (cos >= this.cosLook) {
      this.lookHeld += dt;
      if (this.lookHeld >= c.lookTime - 1e-9) {
        this.seen++;
        this.reactionSum += this.age;
        this.lastFactor = this.scoreFactor();
        this.active = false;
        this.nextAt = time + this.rng.range(c.intervalMin, c.intervalMax);
        this.events.push('signalSeen', '', this.id);
        return SIGNAL_SEEN;
      }
    } else {
      this.lookHeld = 0;
    }

    // Pripomenutie: prvé, keď začne eskalácia, potom stále častejšie (n = eskalácia v %).
    if (this.age >= this.nagAt - 1e-9) {
      this.events.push('signalNag', '', Math.round(e * 100));
      this.nagAt += lerp(c.nagIntervalMax, c.nagIntervalMin, e);
    }
    return SIGNAL_NONE;
  }

  /** Spoluhráč s azimutom azDeg (+ doprava); volá ho step, vo vývoji aj __dr.signal. */
  show(eyeHeight: number, azDeg: number): void {
    const c = this.cfg.headUp;
    this.id++;
    this.active = true;
    this.age = 0;
    this.lookHeld = 0;
    this.blinkPhase = 0;
    this.nagAt = c.graceTime;
    this.azDeg = azDeg;
    const az = azDeg * DEG;
    this.x = Math.sin(az) * c.distance;
    this.y = eyeHeight + c.distance * Math.tan(c.elevationDeg * DEG);
    this.z = -Math.cos(az) * c.distance;
    this.events.push('signal', '', this.id);
  }

  /** Eskalácia 0–1: 0 počas graceTime, potom lineárne až po 1 za escalateTime; bez spoluhráča 0. */
  escalation(): number {
    if (!this.enabled || !this.active) return 0;
    const c = this.cfg.headUp;
    return clamp((this.age - c.graceTime) / c.escalateTime, 0, 1);
  }

  /** Sila zatmavenia 0–maxDarkness (bez blikania). */
  darkness(): number {
    return this.cfg.headUp.maxDarkness * smoothstep(this.escalation());
  }

  /** Horná hranica tmy (elevácia v stupňoch): najprv len pod horizontom, pri silnej eskalácii celé zorné pole. */
  spread(): number {
    const c = this.cfg.headUp;
    const t = clamp((this.escalation() - c.spreadFrom) / (1 - c.spreadFrom), 0, 1);
    return lerp(c.spreadStartDeg, c.spreadEndDeg, smoothstep(t));
  }

  /** Blikanie: násobok tmy 1 (bez blikania) až 1 − blinkDepth (najsvetlejší okamih pulzu). */
  blink(): number {
    const e = this.escalation();
    return 1 - this.cfg.headUp.blinkDepth * e * (0.5 - 0.5 * Math.cos(2 * Math.PI * this.blinkPhase));
  }

  /** Násobok bodov pri pohľade teraz: 1 do konca graceTime, potom klesá až na lateScoreFactor. */
  scoreFactor(): number {
    return lerp(1, this.cfg.headUp.lateScoreFactor, this.escalation());
  }
}
