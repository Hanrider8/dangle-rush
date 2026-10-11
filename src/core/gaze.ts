/**
 * Ovládanie pohľadom (dwell). Pohľad je lúč z hlavy v smere headsetu (Quest 3 nemá eye tracking).
 *
 * - Plnenie začne, keď lúč trafí tlačidlo.
 * - Preruší sa, až keď lúč opustí tlačidlo zväčšené o hysterézu (~3° za hranou)
 *   dlhšie ako graceTime (krátke výpadky progres len podržia).
 * - Po aktivácii platí cooldown pre všetky tlačidlá a tlačidlo pod pohľadom sa dá plniť, až keď
 *   z neho pohľad najprv odíde. Inak by hráč, ktorý po Pauze ďalej pozerá na to isté miesto,
 *   po chvíli spustil „Pokračovať“ (alebo nové tlačidlo na práve otvorenom paneli).
 * - Tlačidlo s requireEntry (Pauza) sa dá plniť, až keď pohľad aspoň raz opustí jeho okolie.
 * - Kurzor je viditeľný, len keď je pohľad do cursorMaxAngleDeg od stredu niektorého tlačidla.
 */
import type { EventQueue } from './events';
import { DEG, vec3 } from './math';
import type { ButtonId, Rect3, Vec3 } from './types';

export interface GazeButton extends Rect3 {
  readonly id: ButtonId;
  requireEntry: boolean;
  /** Pri requireEntry: pohľad už bol mimo tlačidla, takže sa môže plniť. */
  armed: boolean;
}

export interface GazeConfig {
  dwellTime: number;
  hysteresisDeg: number;
  graceTime: number;
  cooldown: number;
  cursorMaxAngleDeg: number;
  tickInterval: number;
}

/**
 * Trafí lúč (p, f) obdĺžnik zväčšený o marginTan · vzdialenosť na každú stranu?
 * f musí byť jednotkový. Bez alokácií.
 */
export function hitsRect(r: Rect3, p: Vec3, f: Vec3, marginTan: number): boolean {
  const denom = f.x * r.nx + f.y * r.ny + f.z * r.nz;
  if (denom > -1e-6) return false; // pozerá sa od tlačidla alebo s ním rovnobežne
  const wx = r.cx - p.x;
  const wy = r.cy - p.y;
  const wz = r.cz - p.z;
  const t = (wx * r.nx + wy * r.ny + wz * r.nz) / denom;
  if (t <= 0) return false;
  const hx = p.x + f.x * t - r.cx;
  const hy = p.y + f.y * t - r.cy;
  const hz = p.z + f.z * t - r.cz;
  const lx = hx * r.ux + hy * r.uy + hz * r.uz;
  const ly = hx * r.vx + hy * r.vy + hz * r.vz;
  const margin = marginTan > 0 ? marginTan * Math.sqrt(wx * wx + wy * wy + wz * wz) : 0;
  return Math.abs(lx) <= r.halfW + margin && Math.abs(ly) <= r.halfH + margin;
}

/** Uhol (v stupňoch) medzi smerom pohľadu a smerom k stredu obdĺžnika. */
export function angleToRectDeg(r: Rect3, p: Vec3, f: Vec3): number {
  const wx = r.cx - p.x;
  const wy = r.cy - p.y;
  const wz = r.cz - p.z;
  const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (len < 1e-9) return 0;
  const c = (f.x * wx + f.y * wy + f.z * wz) / len;
  return Math.acos(c < -1 ? -1 : c > 1 ? 1 : c) / DEG;
}

export class GazeSystem {
  dwellTime: number;
  focused: GazeButton | null = null;
  /** Progres plnenia 0–1. */
  progress = 0;
  cooldownLeft = 0;
  cursorVisible = false;
  readonly cursor = vec3();
  readonly cursorNormal = vec3(0, 0, 1);
  /** Uhol k najbližšiemu aktívnemu tlačidlu (pre debug overlay). */
  nearestAngleDeg = 180;

  private buttons: readonly GazeButton[] = [];
  private outsideTime = 0;
  private tickTime = 0;
  private readonly hysteresisTan: number;

  constructor(
    private readonly cfg: GazeConfig,
    private readonly events: EventQueue,
  ) {
    this.dwellTime = cfg.dwellTime;
    this.hysteresisTan = Math.tan(cfg.hysteresisDeg * DEG);
  }

  get focusedId(): ButtonId | null {
    return this.focused ? this.focused.id : null;
  }

  get activeButtons(): readonly GazeButton[] {
    return this.buttons;
  }

  /**
   * Nová sada aktívnych tlačidiel (pri zmene stavu alebo panelu). Ak ju vyvolala aktivácia
   * (beží cooldown), musí pohľad z každého tlačidla najprv odísť.
   */
  setButtons(buttons: readonly GazeButton[]): void {
    this.buttons = buttons;
    const afterActivation = this.cooldownLeft > 0;
    for (let i = 0; i < buttons.length; i++) {
      buttons[i]!.armed = !afterActivation && !buttons[i]!.requireEntry;
    }
    if (this.focused && !buttons.includes(this.focused)) this.cancel(false);
  }

  /**
   * Jeden krok. Vráti id aktivovaného tlačidla alebo null.
   * head a fwd sú v hernom priestore, fwd je jednotkový.
   */
  step(dt: number, head: Vec3, fwd: Vec3, valid: boolean): ButtonId | null {
    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    const buttons = this.buttons;
    if (!valid || buttons.length === 0) {
      if (this.focused) this.cancel(true);
      this.cursorVisible = false;
      this.nearestAngleDeg = 180;
      return null;
    }

    this.updateCursor(head, fwd);

    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i]!;
      if (!b.armed && !hitsRect(b, head, fwd, this.hysteresisTan)) b.armed = true;
    }

    const focused = this.focused;
    if (focused) {
      if (hitsRect(focused, head, fwd, this.hysteresisTan)) {
        this.outsideTime = 0;
        return this.advance(dt);
      }
      this.outsideTime += dt;
      if (this.outsideTime > this.cfg.graceTime) this.cancel(true);
      return null;
    }

    if (this.cooldownLeft > 0) return null;
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i]!;
      if (b.armed && hitsRect(b, head, fwd, 0)) {
        this.focused = b;
        this.progress = 0;
        this.outsideTime = 0;
        this.tickTime = 0;
        this.events.push('dwellStart', b.id);
        return this.advance(dt);
      }
    }
    return null;
  }

  /**
   * Správa sa ako po aktivácii: cooldown a tlačidlá pod pohľadom sa dajú plniť, až keď z nich
   * pohľad odíde. Volať pred setButtons pri zmene panelu, ktorú nespôsobil pohľad (vycentrovanie).
   */
  holdOff(): void {
    this.cooldownLeft = this.cfg.cooldown;
    for (let i = 0; i < this.buttons.length; i++) this.buttons[i]!.armed = false;
  }

  reset(): void {
    this.focused = null;
    this.progress = 0;
    this.outsideTime = 0;
    this.cooldownLeft = 0;
    this.cursorVisible = false;
  }

  private advance(dt: number): ButtonId | null {
    const b = this.focused!;
    this.progress += dt / this.dwellTime;
    if (this.progress >= 1 - 1e-9) {
      this.focused = null;
      this.progress = 0;
      this.cooldownLeft = this.cfg.cooldown;
      // Tlačidlá mimo pohľadu sa v ďalšom kroku znovu zapnú, to pod pohľadom až po odchode pohľadu.
      for (let i = 0; i < this.buttons.length; i++) this.buttons[i]!.armed = false;
      this.events.push('activate', b.id);
      return b.id;
    }
    this.tickTime += dt;
    if (this.tickTime >= this.cfg.tickInterval) {
      this.tickTime -= this.cfg.tickInterval;
      this.events.push('dwellTick', b.id, this.progress);
    }
    return null;
  }

  private cancel(emit: boolean): void {
    if (emit && this.focused) this.events.push('dwellCancel', this.focused.id);
    this.focused = null;
    this.progress = 0;
    this.outsideTime = 0;
  }

  private updateCursor(p: Vec3, f: Vec3): void {
    const buttons = this.buttons;
    let best: GazeButton | null = null;
    let bestAngle = 180;
    for (let i = 0; i < buttons.length; i++) {
      const angle = angleToRectDeg(buttons[i]!, p, f);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = buttons[i]!;
      }
    }
    this.nearestAngleDeg = bestAngle;
    const target = this.focused ?? best;
    if (!target || bestAngle > this.cfg.cursorMaxAngleDeg) {
      this.cursorVisible = false;
      return;
    }
    // Kurzor leží na rovine tlačidla (všetky tlačidlá panelu sú v jednej rovine).
    const denom = f.x * target.nx + f.y * target.ny + f.z * target.nz;
    if (denom > -1e-6) {
      this.cursorVisible = false;
      return;
    }
    const t =
      ((target.cx - p.x) * target.nx + (target.cy - p.y) * target.ny + (target.cz - p.z) * target.nz) / denom;
    this.cursor.x = p.x + f.x * t;
    this.cursor.y = p.y + f.y * t;
    this.cursor.z = p.z + f.z * t;
    this.cursorNormal.x = target.nx;
    this.cursorNormal.y = target.ny;
    this.cursorNormal.z = target.nz;
    this.cursorVisible = true;
  }
}
