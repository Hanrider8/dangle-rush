/**
 * Vstupy z ovládačov a rúk sa počas celej hry ignorujú: ruky na hokejke by mohli vyvolať
 * falošné select/squeeze/pinch. Nevoláme getController ani getHand a hand-tracking nežiadame.
 * Udalosti len počítame, aby sa dalo v debug overlayi overiť, že prišli a nič nespustili.
 */
const IGNORED_EVENTS = ['selectstart', 'select', 'selectend', 'squeezestart', 'squeeze', 'squeezeend'];

export class InputGuard {
  ignoredCount = 0;
  private readonly onInput = (): void => {
    this.ignoredCount++;
  };

  attach(session: XRSession): void {
    for (const type of IGNORED_EVENTS) session.addEventListener(type, this.onInput);
  }
}
