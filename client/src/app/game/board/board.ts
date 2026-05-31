import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, signal, SimpleChanges } from '@angular/core';
import { Cell, GamePlayer, GameState } from '../../types';
import { cellGridPos } from '../utils/board.gen';

function getPath(from: number, to: number, size = 28): number[] {
  if (from === to) return [];
  const path: number[] = [];
  let curr = from;
  do {
    curr = (curr + 1) % size;
    path.push(curr);
  } while (curr !== to);
  return path;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

@Component({
  selector: 'app-board',
  imports: [],
  templateUrl: './board.html',
  styleUrl: './board.css',
})
export class Board implements OnChanges, OnDestroy {
  @Input({ required: true }) state!: GameState;
  @Input() currentPlayerId = '';
  @Input() isMyTurn = false;

  @Output() tokenMoved  = new EventEmitter<void>();
  @Output() cellClicked = new EventEmitter<number>();

  onCellClick(index: number, e: MouseEvent): void {
    e.stopPropagation();
    this.cellClicked.emit(index);
  }

  protected readonly animatedPositions = signal<Record<string, number>>({});
  private readonly activeAnimations = new Map<string, ReturnType<typeof setInterval>>();

  ngOnChanges(changes: SimpleChanges): void {
    const prev = changes['state']?.previousValue as GameState | undefined;
    const curr = changes['state']?.currentValue as GameState;
    if (!curr) return;

    if (!prev) {
      // First render (reconnect): no animation needed, signal immediately
      this.tokenMoved.emit();
      return;
    }

    for (const player of curr.players) {
      const prevPos = prev.players.find(p => p.id === player.id)?.position;
      if (prevPos !== undefined && prevPos !== player.position) {
        this.stepAnimate(player.id, prevPos, player.position);
      }
    }
  }

  ngOnDestroy(): void {
    this.activeAnimations.forEach(iv => clearInterval(iv));
  }

  private stepAnimate(id: string, from: number, to: number): void {
    const existing = this.activeAnimations.get(id);
    if (existing) clearInterval(existing);

    const path = getPath(from, to);
    if (!path.length) {
      this.tokenMoved.emit();
      return;
    }

    // Start at 'from' immediately so token doesn't jump
    this.animatedPositions.update(p => ({ ...p, [id]: from }));

    let step = 0;
    const iv = setInterval(() => {
      if (step >= path.length) {
        clearInterval(iv);
        this.activeAnimations.delete(id);
        this.animatedPositions.update(p => { const r = { ...p }; delete r[id]; return r; });
        this.tokenMoved.emit();
        return;
      }
      this.animatedPositions.update(p => ({ ...p, [id]: path[step] }));
      step++;
    }, 180);

    this.activeAnimations.set(id, iv);
  }

  cellRow(i: number): number { return cellGridPos(i).row; }
  cellCol(i: number): number { return cellGridPos(i).col; }

  cellIcon(cell: Cell): string {
    if (cell.type === 'start') return '🏰';
    if (cell.type === 'dungeon') return '⚔️';
    if (cell.type === 'event') return '❓';
    if (cell.resourceType === 'wood') return '🪵';
    if (cell.resourceType === 'stone') return '🪨';
    return '💰';
  }

  cellBg(cell: Cell): string {
    if (!cell.owner) return '#fff';
    const color = this.state.players.find(p => p.id === cell.owner)?.color;
    return color ? hexToRgba(color, 0.22) : '#fff';
  }

  ownerBorder(cell: Cell): string {
    if (!cell.owner) return 'transparent';
    return this.state.players.find(p => p.id === cell.owner)?.color ?? 'transparent';
  }

  playersOnCell(index: number): GamePlayer[] {
    const animated = this.animatedPositions();
    return this.state.players.filter(p => {
      if (p.surrendered) return false;
      return (animated[p.id] ?? p.position) === index;
    });
  }

  dungeonStrength(cell: Cell): string {
    if (!cell.garrison?.length) return '';
    return cell.garrison.reduce((s, slot) => s + slot.unit.hp * slot.count, 0).toString();
  }
}
