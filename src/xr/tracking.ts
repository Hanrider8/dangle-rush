/**
 * Detekcia straty trackingu hlavy. Krátke výpadky (kratšie ako grace) sa ignorujú,
 * dlhšie hlási ako stratu, aby hra mohla automaticky pauznúť.
 */
export type TrackingChange = 'lost' | 'restored' | null;

export class TrackingMonitor {
  lost = false;
  private invalidTime = 0;

  constructor(private readonly grace: number) {}

  update(dt: number, valid: boolean): TrackingChange {
    if (valid) {
      this.invalidTime = 0;
      if (!this.lost) return null;
      this.lost = false;
      return 'restored';
    }
    this.invalidTime += dt;
    if (this.lost || this.invalidTime <= this.grace) return null;
    this.lost = true;
    return 'lost';
  }

  reset(): void {
    this.lost = false;
    this.invalidTime = 0;
  }
}
