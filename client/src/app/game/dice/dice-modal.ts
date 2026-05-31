import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { rollDice } from '../utils/turn';

@Component({
  selector: 'app-dice-modal',
  imports: [],
  templateUrl: './dice-modal.html',
  styleUrl: './dice-modal.css',
})
export class DiceModal {
  @Input() hasRing = false;
  @Input() title = '🎲 Бросок кубика';
  @Output() rolled = new EventEmitter<number>();

  protected readonly die1     = signal<number | null>(null);
  protected readonly die2     = signal<number | null>(null);
  protected readonly rolling  = signal(false);
  protected readonly done     = signal(false);

  protected get total(): number {
    return (this.die1() ?? 0) + (this.die2() ?? 0) + (this.hasRing ? 1 : 0);
  }

  protected doRoll(): void {
    if (this.rolling() || this.done()) return;

    const total = rollDice(this.hasRing);
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = total - d1 - (this.hasRing ? 1 : 0);
    const d2clamped = Math.max(1, Math.min(6, d2));
    const d1final = total - d2clamped - (this.hasRing ? 1 : 0);

    this.rolling.set(true);

    setTimeout(() => {
      this.die1.set(d1final);
      this.die2.set(d2clamped);
      this.rolling.set(false);
      this.done.set(true);

      setTimeout(() => this.rolled.emit(total), 700);
    }, 800);
  }
}
