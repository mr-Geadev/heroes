import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { WebsocketService } from '../services/websocket.service';
import { ArmySlot, Cell, DungeonReward, GamePlayer, GameState, HireSlot, JointRequest, PROMISE_LABELS, TradeOffer } from '../types';
import { Board } from './board/board';
import { BattleModal } from './battle/battle-modal';
import { CellActionModal } from './cell-action/cell-action-modal';
import { DiceModal } from './dice/dice-modal';
import { TradeModal } from './trade/trade-modal';
import {
  advanceTurn, prepareEvent, commitEvent, applyOwnCellIncome, calcSourceIncome, checkWin, executeTrade,
  grantCityHireBonus, startCityCapture, requestJointBattle, acceptJoint, declineJoint,
  hireUnit, movePlayer, refreshHirePool, rejectTrade, resolveCombat, transferUnits,
  rollDice, startCapture, startDungeon, startGame, submitInitRoll, surrender, REFRESH_POOL_COST
} from './utils/turn';

@Component({
  selector: 'app-game',
  imports: [Board, DiceModal, CellActionModal, TradeModal, BattleModal],
  templateUrl: './game.html',
  styleUrl: './game.css',
})
export class Game implements OnInit, OnDestroy {
  protected readonly ws = inject(WebsocketService);

  protected readonly state      = computed(() => this.ws.gameState());
  protected readonly me         = computed(() => this.findMe());
  protected readonly isMyTurn   = computed(() => this.checkIsMyTurn());
  protected readonly curPlayer  = computed(() => {
    const s = this.state(); return s ? s.players[s.currentPlayerIndex] : null;
  });
  protected readonly curCell    = computed(() => {
    const s = this.state(); if (!s) return null;
    return s.board[s.players[s.currentPlayerIndex].position];
  });
  protected readonly otherPlayers = computed(() => {
    const s = this.state(); if (!s) return [];
    return s.players.filter(p => p.id !== this.ws.playerId() && !p.surrendered);
  });
  protected readonly lastLog    = computed(() => (this.state()?.log ?? []).slice(-5).reverse());
  protected readonly winner     = computed(() => { const s = this.state(); return s ? checkWin(s) : null; });
  protected readonly incomingOffer = computed(() => {
    const s = this.state();
    return s?.pendingOffer?.to === this.ws.playerId() ? s.pendingOffer : null;
  });
  protected readonly myPromises   = computed(() => this.me()?.promises ?? []);

  // ── Joint battle ──────────────────────────────────────────────────────────
  protected readonly isJointRequester = computed(() =>
    this.state()?.jointRequest?.from === this.ws.playerId()
  );
  protected readonly isJointTarget = computed(() =>
    this.state()?.jointRequest?.to === this.ws.playerId()
  );
  protected readonly jointRequesterName = computed(() => {
    const s = this.state(); if (!s?.jointRequest) return '';
    return s.players.find(p => p.id === s.jointRequest!.from)?.name ?? '';
  });
  protected readonly otherActivePlayers = computed(() => {
    const s = this.state(); if (!s) return [];
    return s.players.filter(p => p.id !== this.ws.playerId() && !p.surrendered);
  });

  protected readonly showTradeModal   = signal(false);
  protected readonly tradeTargetId    = signal('');

  // ── Army / garrison rearrangement ────────────────────────────────────────
  protected readonly dragSrc = signal<{ kind: 'army'; idx: number } | { kind: 'garrison'; cellIndex: number; idx: number } | null>(null);

  protected readonly splitModal = signal<{
    from: { kind: 'army' } | { kind: 'garrison'; cellIndex: number };
    fromIdx: number;
    to:   { kind: 'army' } | { kind: 'garrison'; cellIndex: number };
    toIdx: number;
    mode: 'split' | 'merge';
    fromCount: number; toCount: number;
    value: number;
  } | null>(null);

  protected readonly armySlots = computed(() => {
    const army = this.me()?.army ?? [];
    return Array.from({ length: 5 }, (_, i) => army[i] ?? null);
  });

  protected readonly myArmyCompact = computed(() =>
    (this.me()?.army ?? []).filter((a): a is ArmySlot => a !== null)
  );

  protected readonly myOwnedCells = computed(() => {
    const s = this.state(); const myId = this.ws.playerId();
    return (s?.board ?? []).filter(c =>
      (c.type === 'resource' || c.type === 'start') && c.owner === myId
    );
  });

  protected garrisonSlots(cellIndex: number): (ArmySlot | null)[] {
    const cell = this.state()?.board[cellIndex];
    return Array.from({ length: 5 }, (_, i) => cell?.playerGarrison?.[i] ?? null);
  }

  protected cellIcon(cell: Cell): string {
    if (cell.type === 'start') return '🏰';
    if (cell.resourceType === 'wood')  return '🪵';
    if (cell.resourceType === 'stone') return '🪨';
    return '💰';
  }

  protected readonly canRearrangeArmy = computed(() =>
    this.isMyTurn() && this.state()?.phase !== 'combat'
  );

  protected readonly garrisonModal     = signal<number | null>(null);
  protected readonly garrisonModalIdx  = computed(() => this.garrisonModal() ?? -1);
  protected readonly garrisonModalCell = computed(() => {
    const idx = this.garrisonModal();
    if (idx === null) return null;
    return this.state()?.board[idx] ?? null;
  });

  protected garrisonCount(cellIndex: number): number {
    return this.state()?.board[cellIndex]?.playerGarrison?.filter(s => s !== null).length ?? 0;
  }

  protected onBoardCellClick(cellIndex: number): void {
    const cell = this.state()?.board[cellIndex];
    if ((cell?.type === 'resource' || cell?.type === 'start') && cell.owner === this.ws.playerId()) {
      this.garrisonModal.set(cellIndex);
    }
  }

  protected openGarrisonModal(cellIndex: number): void {
    this.garrisonModal.set(cellIndex);
  }

  protected onDropToCell(cellIndex: number, e: DragEvent): void {
    e.preventDefault();
    const src = this.dragSrc();
    this.dragSrc.set(null);
    if (!src || !this.canRearrangeArmy()) return;

    const cell = this.state()?.board[cellIndex];
    const garrison = cell?.playerGarrison ?? Array(5).fill(null);
    const emptyIdx = garrison.findIndex((s: ArmySlot | null) => s === null);
    if (emptyIdx === -1) return;

    const toLoc = { kind: 'garrison' as const, cellIndex };
    const fromLoc = src.kind === 'army'
      ? { kind: 'army' as const }
      : { kind: 'garrison' as const, cellIndex: (src as { kind: 'garrison'; cellIndex: number; idx: number }).cellIndex };
    const fromSlot = src.kind === 'army'
      ? this.armySlots()[src.idx]
      : this.garrisonSlots((src as { kind: 'garrison'; cellIndex: number; idx: number }).cellIndex)[src.idx];
    if (!fromSlot) return;

    this.ws.updateGameState(transferUnits(this.gs(), fromLoc, src.idx, toLoc, emptyIdx, fromSlot.count));
  }
  protected readonly eventDescription = computed(() => {
    const s = this.state();
    if (!s || s.phase !== 'cell') return '';
    const cell = s.board[s.players[s.currentPlayerIndex].position];
    if (cell.type !== 'event') return '';
    return s.log[s.log.length - 1] ?? '';
  });
  protected readonly cellModalReady   = signal(false);
  protected readonly godMode          = signal(false);
  protected readonly dungeonRewardPopup = signal<DungeonReward | null>(null);


  protected readonly promiseLabels = PROMISE_LABELS;
  protected readonly hasRing = computed(() =>
    this.me()?.artifacts.some(a => a.slot === 'ring') ?? false
  );

  protected readonly myIncome = computed(() => {
    const s = this.state();
    const me = this.me();
    if (!s || !me) return { wood: 1, stone: 1, gold: 1 };
    const src = calcSourceIncome(me, s.board);
    return { wood: 1 + src.wood, stone: 1 + src.stone, gold: 1 + src.gold };
  });

  protected readonly iHaveInitRolled = computed(() => {
    const s = this.state();
    return s?.phase === 'init_roll' && s.initRolls?.[this.ws.playerId()] !== undefined;
  });

  protected readonly allInitRolled = computed(() => {
    const s = this.state();
    return s?.phase === 'init_roll' && s.players.every(p => s.initRolls?.[p.id] !== undefined);
  });

  protected readonly initCountdown = signal<number | null>(null);

  protected readonly initRollStatus = computed(() => {
    const s = this.state();
    if (!s || s.phase !== 'init_roll') return [];
    return s.players.map(p => ({
      id: p.id, name: p.name, color: p.color,
      roll: s.initRolls?.[p.id],
    }));
  });

  protected readonly refreshCost = REFRESH_POOL_COST;

  protected hireTotalCost(slot: HireSlot): { wood: number; stone: number; gold: number } {
    return {
      wood:  slot.unit.cost.wood  * slot.count,
      stone: slot.unit.cost.stone * slot.count,
      gold:  slot.unit.cost.gold  * slot.count,
    };
  }

  protected canAffordRefresh(): boolean {
    const r = this.me()?.resources;
    if (!r) return false;
    return r.wood >= REFRESH_POOL_COST && r.stone >= REFRESH_POOL_COST && r.gold >= REFRESH_POOL_COST;
  }

  protected canAffordSlot(slot: HireSlot): boolean {
    const s = this.state();
    const me = this.me();
    if (!s || !me) return false;
    const army = me.army;
    const hasSlot = army.some(a => a && a.unit.name === slot.unit.name) || army.some(a => a === null);
    if (!hasSlot) return false;
    const c = this.hireTotalCost(slot);
    return me.resources.wood >= c.wood && me.resources.stone >= c.stone && me.resources.gold >= c.gold;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private gs(): GameState { return this.ws.gameState()!; }

  private initRollTimer?: ReturnType<typeof setInterval>;

  constructor() {
    // Reset cellModalReady at the start of every turn so observers also wait for animation
    effect(() => {
      if (this.state()?.phase === 'roll') {
        this.cellModalReady.set(false);
      }
    });

    effect(() => {
      if (this.allInitRolled()) {
        if (this.initRollTimer) return; // already running
        let remaining = 5;
        this.initCountdown.set(remaining);
        this.initRollTimer = setInterval(() => {
          remaining--;
          this.initCountdown.set(remaining);
          if (remaining <= 0) {
            clearInterval(this.initRollTimer);
            this.initRollTimer = undefined;
            if (this.state()?.phase === 'init_roll') {
              this.ws.updateGameState(startGame(this.gs()));
            }
          }
        }, 1000);
      } else {
        if (this.initRollTimer) {
          clearInterval(this.initRollTimer);
          this.initRollTimer = undefined;
          this.initCountdown.set(null);
        }
      }
    });
  }

  private findMe(): GamePlayer | null {
    const s = this.state();
    if (!s) return null;
    return s.players.find(p => p.id === this.ws.playerId()) ?? s.players[0];
  }

  private checkIsMyTurn(): boolean {
    const s = this.state();
    if (!s) return false;
    return s.players[s.currentPlayerIndex].id === this.ws.playerId();
  }

  protected senderName(playerId: string): string {
    return this.state()?.players.find(p => p.id === playerId)?.name ?? '?';
  }

  // ── Dice + Movement ───────────────────────────────────────────────────────

  protected onTokenMoved(): void {
    this.cellModalReady.set(true);
  }

  protected onInitRoll(roll: number): void {
    this.ws.updateGameState(submitInitRoll(this.gs(), this.ws.playerId(), roll));
  }

  protected onDiceRolled(roll: number): void {
    this.cellModalReady.set(false);
    let s = movePlayer(this.gs(), roll);
    const player = s.players[s.currentPlayerIndex];
    const cell = s.board[player.position];

    if (cell.type === 'event') {
      s = prepareEvent(s);
      s = { ...s, phase: 'cell' };
    } else {
      s = this.resolveLandingCell(s);
    }

    this.ws.updateGameState(s);
  }

  // ── Cell actions ──────────────────────────────────────────────────────────

  // Resolves what phase to enter after landing on a non-event cell
  private resolveLandingCell(s: GameState): GameState {
    const player = s.players[s.currentPlayerIndex];
    const cell = s.board[player.position];
    if (cell.type === 'resource' && cell.owner === player.id) {
      s = applyOwnCellIncome(s, player.position);
      return { ...s, phase: 'free' };
    }
    if (cell.type === 'start') {
      if (cell.owner === player.id) {
        s = grantCityHireBonus(s);
        s.log.push(`${player.name} остановился в своём городе — +1 найм`);
        return { ...s, phase: 'free' };
      }
      if (cell.owner && cell.owner !== player.id) {
        return { ...s, phase: 'cell' };
      }
      return { ...s, phase: 'free' };
    }
    if (cell.type === 'event' || (cell.type === 'dungeon' && cell.dungeonCleared)) {
      return { ...s, phase: 'free' };
    }
    return { ...s, phase: 'cell' };
  }

  protected onCellAction(action: 'capture' | 'dungeon' | 'skip'): void {
    this.cellModalReady.set(false);
    let s = this.gs();
    const pos = s.players[s.currentPlayerIndex].position;
    const cell = s.board[pos];

    if (action === 'capture') {
      this.ws.updateGameState(
        cell.type === 'start' ? startCityCapture(s, pos) : startCapture(s, pos)
      );
    } else if (action === 'dungeon') {
      this.ws.updateGameState(startDungeon(s, pos));
    } else if (cell.type === 'event') {
      s = commitEvent(s);
      s = this.resolveLandingCell(s);
      if (s.phase === 'cell') this.cellModalReady.set(true);
      this.ws.updateGameState(s);
    } else {
      this.ws.updateGameState({ ...s, phase: 'free' });
    }
  }

  protected onRequestJoint(toId: string): void {
    const s = this.gs();
    const pos = s.players[s.currentPlayerIndex].position;
    const cell = s.board[pos];
    const combatType: JointRequest['combatType'] =
      cell.type === 'start' ? 'city' : cell.type === 'dungeon' ? 'dungeon' : 'resource';
    this.cellModalReady.set(false);
    this.ws.updateGameState(requestJointBattle(s, toId, pos, combatType));
  }

  protected onAcceptJoint(): void {
    this.cellModalReady.set(false);
    this.ws.updateGameState(acceptJoint(this.gs()));
  }

  protected onDeclineJoint(): void {
    this.cellModalReady.set(true);
    this.ws.updateGameState(declineJoint(this.gs()));
  }

  // ── Battle ────────────────────────────────────────────────────────────────

  protected onBattleDone(): void {
    const s = this.gs();
    const data = s.combatData;
    if (data?.combatType === 'dungeon' && data.attackerWon) {
      const reward = s.board[data.cellIndex]?.dungeonReward;
      if (reward) this.dungeonRewardPopup.set(reward);
    }
    this.ws.updateGameState(resolveCombat(s));
  }

  // ── Hire ─────────────────────────────────────────────────────────────────

  protected onHired(poolIndex: number): void {
    this.ws.updateGameState(hireUnit(this.gs(), poolIndex));
  }

  protected onPoolRefreshed(): void {
    this.ws.updateGameState(refreshHirePool(this.gs()));
  }

  // ── End turn ──────────────────────────────────────────────────────────────

  protected endTurn(): void {
    this.ws.updateGameState(advanceTurn(this.gs()));
  }

  // ── Trade ─────────────────────────────────────────────────────────────────

  protected onDragStart(src: { kind: 'army'; idx: number } | { kind: 'garrison'; cellIndex: number; idx: number }, e: DragEvent): void {
    if (!this.canRearrangeArmy()) { e.preventDefault(); return; }
    this.dragSrc.set(src);
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', '');
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  protected onDrop(to: { kind: 'army'; idx: number } | { kind: 'garrison'; cellIndex: number; idx: number }, e: DragEvent): void {
    e.preventDefault();
    const src = this.dragSrc();
    this.dragSrc.set(null);
    if (!src) return;

    // Same slot — no-op
    if (src.kind === to.kind && src.idx === to.idx &&
        (src.kind !== 'garrison' || (src as any).cellIndex === (to as any).cellIndex)) return;

    const fromLoc: { kind: 'army' } | { kind: 'garrison'; cellIndex: number } =
      src.kind === 'army' ? { kind: 'army' } : { kind: 'garrison', cellIndex: (src as any).cellIndex };
    const toLoc: { kind: 'army' } | { kind: 'garrison'; cellIndex: number } =
      to.kind === 'army' ? { kind: 'army' } : { kind: 'garrison', cellIndex: (to as any).cellIndex };

    const getSlot = (loc: typeof fromLoc, idx: number): ArmySlot | null => {
      if (loc.kind === 'army') return this.armySlots()[idx];
      return this.garrisonSlots((loc as any).cellIndex)[idx];
    };

    const from = getSlot(fromLoc, src.idx);
    const toSlot = getSlot(toLoc, to.idx);
    if (!from) return;

    if (!toSlot) {
      if (from.count === 1) {
        this.ws.updateGameState(transferUnits(this.gs(), fromLoc, src.idx, toLoc, to.idx, 1));
      } else {
        this.splitModal.set({ from: fromLoc, fromIdx: src.idx, to: toLoc, toIdx: to.idx, mode: 'split', fromCount: from.count, toCount: 0, value: from.count });
      }
    } else if (from.unit.name === toSlot.unit.name) {
      this.splitModal.set({ from: fromLoc, fromIdx: src.idx, to: toLoc, toIdx: to.idx, mode: 'merge', fromCount: from.count, toCount: toSlot.count, value: from.count });
    } else {
      this.ws.updateGameState(transferUnits(this.gs(), fromLoc, src.idx, toLoc, to.idx, from.count));
    }
  }

  protected onSplitConfirm(): void {
    const m = this.splitModal();
    if (!m) return;
    this.ws.updateGameState(transferUnits(this.gs(), m.from, m.fromIdx, m.to, m.toIdx, m.value));
    this.splitModal.set(null);
  }

  protected setSplitValue(v: number): void {
    this.splitModal.update(m => m ? { ...m, value: v } : null);
  }

  protected openTradeWith(playerId: string): void { this.tradeTargetId.set(playerId); this.showTradeModal.set(true); }
  protected closeTrade(): void { this.showTradeModal.set(false); this.tradeTargetId.set(''); }

  protected submitOffer(offer: TradeOffer): void {
    this.ws.updateGameState({ ...this.gs(), pendingOffer: offer });
    this.showTradeModal.set(false);
  }

  protected acceptOffer(): void {
    this.ws.updateGameState(executeTrade(this.gs(), this.gs().pendingOffer!));
  }

  protected rejectOffer(): void {
    this.ws.updateGameState(rejectTrade(this.gs()));
  }

  protected counterOffer(offer: TradeOffer): void {
    // Counter-offer is just a new pending offer replacing the current one
    this.ws.updateGameState({ ...this.gs(), pendingOffer: offer });
  }

  // ── Surrender ─────────────────────────────────────────────────────────────

  protected doSurrender(): void {
    if (!confirm('Сдаться? Это необратимо.')) return;
    this.ws.updateGameState(surrender(this.gs(), this.ws.playerId()));
  }

  // ── Debug commands (browser console) ─────────────────────────────────────

  ngOnInit(): void {
    (window as any)['moveTo'] = (cellIndex: number) => {
      if (cellIndex < 0 || cellIndex > 27) { console.warn('moveTo: index 0–27'); return; }
      let s = JSON.parse(JSON.stringify(this.gs())) as GameState;
      s.players[s.currentPlayerIndex].position = cellIndex;
      const cell = s.board[cellIndex];
      if (cell.type === 'event') {
        s = prepareEvent(s);
        s = { ...s, phase: 'cell' };
        this.cellModalReady.set(true);
      } else {
        s = this.resolveLandingCell(s);
        if (s.phase === 'cell') this.cellModalReady.set(true);
      }
      this.ws.updateGameState(s);
      console.log(`moveTo(${cellIndex}) ✓`);
    };

    (window as any)['IDDQD'] = () => {
      const s = JSON.parse(JSON.stringify(this.gs())) as GameState;
      s.godMode = !s.godMode;
      this.godMode.set(!!s.godMode);
      this.ws.updateGameState(s);
      console.log(`God mode: ${s.godMode ? 'ON ☠' : 'OFF'}`);
    };

    (window as any)['HESOYAM'] = () => {
      const s = JSON.parse(JSON.stringify(this.gs())) as GameState;
      s.players[s.currentPlayerIndex].resources.wood  += 100;
      s.players[s.currentPlayerIndex].resources.stone += 100;
      s.players[s.currentPlayerIndex].resources.gold  += 100;
      this.ws.updateGameState(s);
      console.log('HESOYAM ✓ +100 each resource');
    };

    (window as any)['aezakmi'] = () => {
      this.showTradeModal.set(false);
      this.garrisonModal.set(null);
      this.splitModal.set(null);
      this.dungeonRewardPopup.set(null);
      this.cellModalReady.set(false);
      this.ws.updateGameState(advanceTurn(this.gs()));
      console.log('aezakmi ✓ turn skipped');
    };
  }

  ngOnDestroy(): void {
    if (this.initRollTimer) clearInterval(this.initRollTimer);
    delete (window as any)['moveTo'];
    delete (window as any)['IDDQD'];
    delete (window as any)['HESOYAM'];
    delete (window as any)['aezakmi'];
  }
}
