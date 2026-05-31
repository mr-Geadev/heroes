import { Component, computed, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { CombatData, UnitSnap } from '../../types';

@Component({
  selector: 'app-battle-modal',
  imports: [],
  templateUrl: './battle-modal.html',
  styleUrl: './battle-modal.css',
})
export class BattleModal implements OnInit {
  @Input({ required: true }) data!: CombatData;
  @Input() isMine = false;
  @Input() activePlayerName = '';

  @Output() done = new EventEmitter<void>();

  // Live army state shown in the UI — updated after each event
  // Attacker snaps are 5-element (with nulls for empty slots); defender compact
  protected readonly atkSnaps = signal<(UnitSnap | null)[]>([]);
  protected readonly defSnaps = signal<UnitSnap[]>([]);

  // Which slots are currently highlighted
  protected readonly activeAtkSlot = signal(-1);
  protected readonly activeDefSlot = signal(-1);

  // Lunge animation: index of slot lunging toward enemy (-1 = none)
  protected readonly lungeAtkSlot = signal(-1);
  protected readonly lungeDefSlot = signal(-1);

  // Damage popups
  protected readonly dmgOnDef = signal<number | null>(null);
  protected readonly dmgOnAtk = signal<number | null>(null);

  protected readonly finished   = signal(false);
  protected readonly eventIdx   = signal(-1);

  protected readonly currentRound = computed(() => {
    const idx = this.eventIdx();
    if (idx < 0 || idx >= this.data.events.length) return 0;
    return this.data.events[idx].roundNumber;
  });

  protected hpPct(u: UnitSnap): number {
    return Math.max(0, Math.round((u.hp / u.maxHp) * 100));
  }

  protected hpColor(pct: number): string {
    if (pct > 60) return '#27ae60';
    if (pct > 30) return '#f39c12';
    return '#e74c3c';
  }

  ngOnInit(): void {
    if (!this.data?.events.length) {
      this.finished.set(true);
      return;
    }
    this.atkSnaps.set(this.data.initialAtkSnaps);
    this.defSnaps.set(this.data.initialDefSnaps);
    setTimeout(() => this.playEvent(0), 800);
  }

  private playEvent(idx: number): void {
    if (idx >= this.data.events.length) {
      this.activeAtkSlot.set(-1);
      this.activeDefSlot.set(-1);
      this.dmgOnAtk.set(null);
      this.dmgOnDef.set(null);
      this.finished.set(true);
      return;
    }

    const ev = this.data.events[idx];
    this.eventIdx.set(idx);
    const atkIsActive = ev.side === 'attacker';

    // 0ms: highlight + lunge toward enemy
    if (atkIsActive) {
      this.activeAtkSlot.set(ev.mySlotIdx);
      this.activeDefSlot.set(ev.targetSlotIdx);
      this.lungeAtkSlot.set(ev.mySlotIdx);
    } else {
      this.activeDefSlot.set(ev.mySlotIdx);
      this.activeAtkSlot.set(ev.targetSlotIdx);
      this.lungeDefSlot.set(ev.mySlotIdx);
    }
    this.dmgOnAtk.set(null);
    this.dmgOnDef.set(null);

    // 180ms: lunge animation done — clear lunge class so it can re-trigger next time
    setTimeout(() => {
      this.lungeAtkSlot.set(-1);
      this.lungeDefSlot.set(-1);
    }, 180);

    // 220ms: apply primary damage + show popup
    setTimeout(() => {
      this.atkSnaps.set(ev.atkSnaps);
      this.defSnaps.set(ev.defSnaps);
      if (atkIsActive) {
        this.dmgOnDef.set(ev.damage);
      } else {
        this.dmgOnAtk.set(ev.damage);
      }
    }, 220);

    // 520ms: retaliation lunge + damage
    setTimeout(() => {
      if (ev.retaliationDamage > 0) {
        if (atkIsActive) {
          this.lungeDefSlot.set(ev.targetSlotIdx);
          this.dmgOnAtk.set(ev.retaliationDamage);
        } else {
          this.lungeAtkSlot.set(ev.targetSlotIdx);
          this.dmgOnDef.set(ev.retaliationDamage);
        }
      }
    }, 520);

    // 700ms: clear retaliation lunge
    setTimeout(() => {
      this.lungeAtkSlot.set(-1);
      this.lungeDefSlot.set(-1);
    }, 700);

    // 950ms: clear highlights and advance
    setTimeout(() => {
      this.activeAtkSlot.set(-1);
      this.activeDefSlot.set(-1);
      this.dmgOnAtk.set(null);
      this.dmgOnDef.set(null);
      this.playEvent(idx + 1);
    }, 950);
  }

  protected resultLabel(): string {
    if (this.data.attackerWon) return '🏆 Победа!';
    if (!this.data.attackerWon && this.data.attackersLeft.length === 0 && this.data.defendersLeft.length === 0) return '💀 Ничья';
    return '💀 Поражение';
  }
}
