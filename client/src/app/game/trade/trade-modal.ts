import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArmySlot, Cell, GamePlayer, PROMISE_LABELS, PromiseType, TradeOffer, TradeSide } from '../../types';

@Component({
  selector: 'app-trade-modal',
  imports: [FormsModule],
  templateUrl: './trade-modal.html',
  styleUrl: './trade-modal.css',
})
export class TradeModal implements OnInit {
  @Input({ required: true }) me!: GamePlayer;
  @Input({ required: true }) players!: GamePlayer[];
  @Input({ required: true }) board!: Cell[];
  @Input() turnNumber = 0;
  /** Pre-select a target player when opening in compose mode */
  @Input() initialTargetId = '';
  /** When set, the modal opens in receive mode */
  @Input() incomingOffer?: TradeOffer;

  @Output() submitted  = new EventEmitter<TradeOffer>();
  @Output() accepted   = new EventEmitter<void>();
  @Output() rejected   = new EventEmitter<void>();
  @Output() cancelled  = new EventEmitter<void>();

  // ── State ────────────────────────────────────────────────────────────────
  protected targetId = '';
  protected giveWood = 0; protected giveStone = 0; protected giveGold = 0;
  protected wantWood = 0; protected wantStone = 0; protected wantGold = 0;
  protected giveCellSet = new Set<number>();
  protected wantCellSet = new Set<number>();
  protected giveArtSet     = new Set<string>();
  protected wantArtSet     = new Set<string>();
  protected givePromiseSet = new Set<PromiseType>();
  protected wantPromiseSet = new Set<PromiseType>();

  /** true = composing/editing; false = viewing an incoming offer */
  protected editMode = true;

  protected readonly promiseOptions: Array<{ type: PromiseType; label: string }> = [
    { type: 'no-attack',   label: PROMISE_LABELS['no-attack'] },
    { type: 'help-battle', label: PROMISE_LABELS['help-battle'] },
  ];

  // ── Derived ───────────────────────────────────────────────────────────────

  protected get target(): GamePlayer | undefined {
    return this.players.find(p => p.id === this.targetId);
  }

  protected get senderPlayer(): GamePlayer | undefined {
    if (!this.incomingOffer) return undefined;
    return this.players.find(p => p.id === this.incomingOffer!.from);
  }

  protected get myCells(): Cell[] {
    return this.board.filter(c => c.type !== 'start' && c.owner === this.me.id && !c.garrison?.length);
  }

  protected get theirCells(): Cell[] {
    const id = this.editMode ? this.targetId : this.incomingOffer?.from;
    return this.board.filter(c => c.type !== 'start' && c.owner === id && !c.garrison?.length);
  }

  protected get theirPlayer(): GamePlayer | undefined {
    if (this.editMode) return this.target;
    return this.senderPlayer;
  }

  // ── Clickable inventory (cols 1 & 4) ─────────────────────────────────────

  protected addGiveResource(type: 'wood' | 'stone' | 'gold'): void {
    if (!this.editMode) return;
    const max = this.me.resources[type];
    if (type === 'wood'  && this.giveWood  < max) this.giveWood++;
    if (type === 'stone' && this.giveStone < max) this.giveStone++;
    if (type === 'gold'  && this.giveGold  < max) this.giveGold++;
  }

  protected addWantResource(type: 'wood' | 'stone' | 'gold'): void {
    if (!this.editMode) return;
    const max = this.theirPlayer?.resources[type] ?? 0;
    if (type === 'wood'  && this.wantWood  < max) this.wantWood++;
    if (type === 'stone' && this.wantStone < max) this.wantStone++;
    if (type === 'gold'  && this.wantGold  < max) this.wantGold++;
  }

  protected toggleGiveCell(idx: number): void {
    if (!this.editMode) return;
    this.giveCellSet.has(idx) ? this.giveCellSet.delete(idx) : this.giveCellSet.add(idx);
  }

  protected toggleWantCell(idx: number): void {
    if (!this.editMode) return;
    this.wantCellSet.has(idx) ? this.wantCellSet.delete(idx) : this.wantCellSet.add(idx);
  }

  protected toggleGiveArt(id: string): void {
    if (!this.editMode) return;
    this.giveArtSet.has(id) ? this.giveArtSet.delete(id) : this.giveArtSet.add(id);
  }

  protected toggleWantArt(id: string): void {
    if (!this.editMode) return;
    this.wantArtSet.has(id) ? this.wantArtSet.delete(id) : this.wantArtSet.add(id);
  }

  protected toggleGivePromise(type: PromiseType): void {
    if (!this.editMode) return;
    this.givePromiseSet.has(type) ? this.givePromiseSet.delete(type) : this.givePromiseSet.add(type);
  }

  protected toggleWantPromise(type: PromiseType): void {
    if (!this.editMode) return;
    this.wantPromiseSet.has(type) ? this.wantPromiseSet.delete(type) : this.wantPromiseSet.add(type);
  }

  // ── Offer column removals ─────────────────────────────────────────────────

  protected removeGiveResource(type: 'wood' | 'stone' | 'gold'): void {
    if (type === 'wood')  this.giveWood  = 0;
    if (type === 'stone') this.giveStone = 0;
    if (type === 'gold')  this.giveGold  = 0;
  }

  protected removeWantResource(type: 'wood' | 'stone' | 'gold'): void {
    if (type === 'wood')  this.wantWood  = 0;
    if (type === 'stone') this.wantStone = 0;
    if (type === 'gold')  this.wantGold  = 0;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  protected cellIcon(cell: Cell): string {
    if (cell.resourceType === 'wood') return '🪵';
    if (cell.resourceType === 'stone') return '🪨';
    return '💰';
  }

  protected cellName(cell: Cell): string {
    if (cell.resourceType === 'wood')  return 'Лесопилка';
    if (cell.resourceType === 'stone') return 'Шахта';
    return 'Прииск';
  }

  protected artifactName(artifacts: { id: string; name: string }[] | undefined, id: string): string {
    return artifacts?.find(a => a.id === id)?.name ?? id;
  }

  protected promiseLabel(type: PromiseType): string {
    return PROMISE_LABELS[type] ?? type;
  }

  // ── Receive mode (incoming offer display) ─────────────────────────────────

  protected get offerGiveCells(): Cell[] {
    return (this.incomingOffer?.give.cellIndices ?? []).map(i => this.board[i]).filter(Boolean);
  }

  protected get offerWantCells(): Cell[] {
    return (this.incomingOffer?.want.cellIndices ?? []).map(i => this.board[i]).filter(Boolean);
  }

  protected get offerGiveArts(): string[] {
    if (!this.incomingOffer || !this.senderPlayer) return [];
    return this.incomingOffer.give.artifactIds
      .map(id => this.senderPlayer!.artifacts.find(a => a.id === id)?.name ?? id);
  }

  protected get offerWantArts(): string[] {
    if (!this.incomingOffer) return [];
    return this.incomingOffer.want.artifactIds
      .map(id => this.me.artifacts.find(a => a.id === id)?.name ?? id);
  }

  // ── Counter-offer ─────────────────────────────────────────────────────────

  protected switchToCounter(): void {
    const offer = this.incomingOffer!;
    // Invert sides: what they gave → I now want; what they wanted → I now give
    this.targetId = offer.from;
    this.giveWood  = offer.want.wood;
    this.giveStone = offer.want.stone;
    this.giveGold  = offer.want.gold;
    this.wantWood  = offer.give.wood;
    this.wantStone = offer.give.stone;
    this.wantGold  = offer.give.gold;
    this.giveCellSet    = new Set(offer.want.cellIndices);
    this.wantCellSet    = new Set(offer.give.cellIndices);
    this.giveArtSet     = new Set(offer.want.artifactIds);
    this.wantArtSet     = new Set(offer.give.artifactIds);
    this.givePromiseSet = new Set(offer.want.promises ?? []);
    this.wantPromiseSet = new Set(offer.give.promises ?? []);
    this.editMode = true;
  }

  // ── Validation & submit ───────────────────────────────────────────────────

  protected isValid(): boolean {
    if (!this.targetId) return false;
    return this.giveWood > 0 || this.giveStone > 0 || this.giveGold > 0 ||
      this.giveCellSet.size > 0 || this.giveArtSet.size > 0 || this.givePromiseSet.size > 0 ||
      this.wantWood > 0 || this.wantStone > 0 || this.wantGold > 0 ||
      this.wantCellSet.size > 0 || this.wantArtSet.size > 0 || this.wantPromiseSet.size > 0;
  }

  protected submit(): void {
    if (!this.isValid()) return;
    const offer: TradeOffer = {
      id: Math.random().toString(36).slice(2),
      from: this.me.id,
      to: this.targetId,
      give: {
        wood: this.giveWood, stone: this.giveStone, gold: this.giveGold,
        cellIndices: [...this.giveCellSet],
        artifactIds: [...this.giveArtSet],
        promises: [...this.givePromiseSet],
      },
      want: {
        wood: this.wantWood, stone: this.wantStone, gold: this.wantGold,
        cellIndices: [...this.wantCellSet],
        artifactIds: [...this.wantArtSet],
        promises: [...this.wantPromiseSet],
      },
    };
    this.submitted.emit(offer);
  }

  ngOnInit(): void {
    if (this.incomingOffer) {
      this.editMode = false;
      this.targetId = this.incomingOffer.from;
    } else {
      this.editMode = true;
      if (this.initialTargetId) this.targetId = this.initialTargetId;
      else if (this.players.length > 0) this.targetId = this.players[0].id;
    }
  }
}
