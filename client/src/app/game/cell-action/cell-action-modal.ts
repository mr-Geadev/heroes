import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ArmySlot, Cell, GamePlayer, PendingEvent } from '../../types';

@Component({
  selector: 'app-cell-action-modal',
  imports: [],
  templateUrl: './cell-action-modal.html',
  styleUrl: './cell-action-modal.css',
})
export class CellActionModal {
  @Input({ required: true }) cell!: Cell;
  @Input() players: GamePlayer[] = [];
  @Input() myArmy: ArmySlot[] = [];
  @Input() eventDescription = '';
  @Input() pendingEvent: PendingEvent | null = null;
  @Input() combatLog: string[] = [];
  @Input() readonly = false;
  @Input() activePlayerName = '';

  @Input() otherPlayers: GamePlayer[] = [];

  @Output() action = new EventEmitter<'capture' | 'dungeon' | 'skip'>();
  @Output() joinRequest = new EventEmitter<string>();

  protected cellIcon(): string {
    if (this.cell.type === 'dungeon') return '⚔️';
    if (this.cell.type === 'event') return '❓';
    if (this.cell.type === 'start') return '🏰';
    if (this.cell.resourceType === 'wood') return '🪵';
    if (this.cell.resourceType === 'stone') return '🪨';
    return '💰';
  }

  protected garrisonDesc(): string {
    return (this.cell.garrison ?? [])
      .filter(s => s.count > 0)
      .map(s => `${s.count > 1 ? s.count + '× ' : ''}${s.unit.name} ❤${s.unit.hp}`)
      .join(', ') || 'нет охраны';
  }

  protected resourceTypeName(): string {
    if (this.cell.resourceType === 'wood')  return 'Лесопилка';
    if (this.cell.resourceType === 'stone') return 'Шахта';
    return 'Прииск';
  }

  protected ownerName(): string {
    if (!this.cell.owner) return '';
    return this.players.find(p => p.id === this.cell.owner)?.name ?? '';
  }
}
