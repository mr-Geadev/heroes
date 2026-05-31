import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ArmySlot, HireSlot } from '../../types';

@Component({
  selector: 'app-hire-modal',
  imports: [],
  templateUrl: './hire-modal.html',
  styleUrl: './hire-modal.css',
})
export class HireModal {
  @Input({ required: true }) pool!: HireSlot[];
  @Input() myResources = { wood: 0, stone: 0, gold: 0 };
  @Input() army: ArmySlot[] = [];

  @Output() hired  = new EventEmitter<number>();
  @Output() closed = new EventEmitter<void>();

  protected totalCost(slot: HireSlot): { wood: number; stone: number; gold: number } {
    return {
      wood:  slot.unit.cost.wood  * slot.count,
      stone: slot.unit.cost.stone * slot.count,
      gold:  slot.unit.cost.gold  * slot.count,
    };
  }

  protected canHire(slot: HireSlot): boolean {
    const cost = this.totalCost(slot);
    if (!( this.myResources.wood  >= cost.wood &&
           this.myResources.stone >= cost.stone &&
           this.myResources.gold  >= cost.gold )) return false;

    const existingSlot = this.army.find(a => a.unit.name === slot.unit.name);
    if (!existingSlot && this.army.length >= 5) return false;
    return true;
  }
}
