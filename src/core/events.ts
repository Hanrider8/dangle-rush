/**
 * Udalosti z hernej logiky pre audio a efekty. Predalokovaný kruhový buffer:
 * v hernej slučke sa nič nealokuje, app ho každý snímok vyprázdni cez drain().
 */
export type GameEventType =
  | 'dwellStart'
  | 'dwellTick'
  | 'dwellCancel'
  | 'activate'
  | 'state'
  | 'countdownBeep'
  | 'go'
  | 'recenterBeep'
  | 'recentered'
  | 'calibrated'
  | 'calibrationFailed'
  | 'settingsChanged'
  | 'spawn'
  | 'passBody'
  | 'passFloor'
  | 'hit'
  | 'cleared'
  | 'gameOver';

export interface GameEvent {
  type: GameEventType;
  /** Textový payload: id tlačidla, typ prekážky, nový stav… */
  id: string;
  /** Číselný payload: progres, číslo odpočtu, počet životov… */
  n: number;
}

export class EventQueue {
  private readonly buffer: GameEvent[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity = 128) {
    this.buffer = [];
    for (let i = 0; i < capacity; i++) this.buffer.push({ type: 'state', id: '', n: 0 });
  }

  get length(): number {
    return this.count;
  }

  push(type: GameEventType, id = '', n = 0): void {
    if (this.count === this.capacity) {
      // Plný buffer: zahodí najstaršiu udalosť.
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
    const e = this.buffer[(this.head + this.count) % this.capacity]!;
    e.type = type;
    e.id = id;
    e.n = n;
    this.count++;
  }

  /** Odovzdá udalosti v poradí a vyprázdni frontu. Objekt udalosti platí len počas volania. */
  drain(handler: (e: GameEvent) => void): void {
    while (this.count > 0) {
      const e = this.buffer[this.head]!;
      this.head = (this.head + 1) % this.capacity;
      this.count--;
      handler(e);
    }
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
