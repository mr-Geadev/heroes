import { Artifact, ArmySlot, CombatData, CombatEvent, GamePlayer, GamePromise, GameState, JointRequest, PendingEvent, TradeOffer, Unit, UnitSnap } from '../../types';
import { dungeonGuard, dungeonReward } from './board.gen';
import { makeHireSlot, ARTIFACT_POOL } from './units';

// ── Helpers ──────────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function canAfford(
  res: GamePlayer['resources'],
  cost: { wood: number; stone: number; gold: number }
): boolean {
  return res.wood >= cost.wood && res.stone >= cost.stone && res.gold >= cost.gold;
}

function totalResources(res: GamePlayer['resources']): number {
  return res.wood + res.stone + res.gold;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rollRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function slotTotalHp(slot: ArmySlot): number {
  return (slot.count - 1) * slot.unit.maxHp + slot.unit.hp;
}

function applyDamageToSlot(slot: ArmySlot, dmg: number): ArmySlot {
  const remaining = Math.max(0, slotTotalHp(slot) - dmg);
  if (remaining === 0) return { unit: slot.unit, count: 0 };
  const fullUnits = Math.floor(remaining / slot.unit.maxHp);
  const partialHp = remaining % slot.unit.maxHp;
  const count = partialHp > 0 ? fullUnits + 1 : fullUnits;
  const hp = partialHp > 0 ? partialHp : slot.unit.maxHp;
  return { unit: { ...slot.unit, hp }, count };
}

function rollSlotDamage(slot: ArmySlot): number {
  let total = 0;
  for (let i = 0; i < slot.count; i++) {
    total += rollRange(slot.unit.damageMin, slot.unit.damageMax);
  }
  return total;
}

function applyArtifactBonuses(slots: (ArmySlot | null)[], artifacts: Artifact[]): (ArmySlot | null)[] {
  const armor  = artifacts.some(a => a.slot === 'armor')  ? 2 : 0;
  const weapon = artifacts.some(a => a.slot === 'weapon') ? 1 : 0;
  if (armor === 0 && weapon === 0) return slots;
  return slots.map(s => s === null ? null : ({
    ...s,
    unit: {
      ...s.unit,
      hp: s.unit.hp + armor,
      maxHp: s.unit.maxHp + armor,
      damageMin: s.unit.damageMin + weapon,
      damageMax: s.unit.damageMax + weapon,
    },
  }));
}

// ── Combat simulation ─────────────────────────────────────────────────────────

function snapshots(slots: ArmySlot[]): UnitSnap[] {
  return slots.map(s => ({
    name: s.unit.name,
    count: s.count,
    hp: s.unit.hp,
    maxHp: s.unit.maxHp,
    damageMin: s.unit.damageMin,
    damageMax: s.unit.damageMax,
  }));
}

export function simulateCombat(
  rawAttackers: (ArmySlot | null)[],
  rawDefenders: ArmySlot[],
  godMode = false,
  rawAlly?: (ArmySlot | null)[],
  atkDamageMult = 1.0
): Omit<CombatData, 'cellIndex' | 'combatType' | 'allyPlayerId'> {
  // Compact working arrays + position maps (compactIdx → original slot 0-4)
  const posMap: number[] = [];
  const atk = rawAttackers.flatMap((s, i) => {
    if (!s) return [];
    posMap.push(i);
    return [{ unit: { ...s.unit }, count: s.count }];
  });

  const posMapAlly: number[] = [];
  const ally = rawAlly ? rawAlly.flatMap((s, i) => {
    if (!s) return [];
    posMapAlly.push(i);
    return [{ unit: { ...s.unit }, count: s.count }];
  }) : null;

  const def = rawDefenders.map(s => ({ unit: { ...s.unit }, count: s.count }));

  // atkSnaps: 5 slots when solo, 10 slots when joint (0-4 = attacker, 5-9 = ally)
  const snapSize = ally ? 10 : 5;
  const positionedAtkSnaps = (): (UnitSnap | null)[] => {
    const result: (UnitSnap | null)[] = Array(snapSize).fill(null);
    atk.forEach((s, i) => { result[posMap[i]] = snapshots([s])[0]; });
    if (ally) ally.forEach((s, j) => { result[5 + posMapAlly[j]] = snapshots([s])[0]; });
    return result;
  };

  const initialAtkSnaps = positionedAtkSnaps();
  const initialDefSnaps = snapshots(def);
  const events: CombatEvent[] = [];
  let roundNumber = 0;

  for (let r = 0; r < 20; r++) {
    const atkAliveNow = atk.some(s => s.count > 0) || (ally ? ally.some(s => s.count > 0) : false);
    if (!atkAliveNow || !def.some(s => s.count > 0)) break;
    roundNumber++;

    // Queue: atk[i], ally[i], def[i] per slot (or atk[i], def[i] when no ally)
    type QueueEntry = { side: 'attacker' | 'ally' | 'defender'; idx: number };
    const queue: QueueEntry[] = [];
    const maxSlots = Math.max(atk.length, ally ? ally.length : 0, def.length);
    for (let i = 0; i < maxSlots; i++) {
      if (i < atk.length)  queue.push({ side: 'attacker', idx: i });
      if (ally && i < ally.length) queue.push({ side: 'ally', idx: i });
      if (i < def.length)  queue.push({ side: 'defender', idx: i });
    }

    const retaliated = new Set<string>();

    for (const entry of queue) {
      const isAtkSide = entry.side !== 'defender';
      const mySide: ArmySlot[] = entry.side === 'attacker' ? atk : entry.side === 'ally' ? ally! : def;
      const mySlot = mySide[entry.idx];
      if (!mySlot || mySlot.count <= 0) continue;

      // Find target
      let tIdx: number;
      let tSideArr: ArmySlot[];
      let tSideKey: string;

      if (isAtkSide) {
        // Attacker/ally targets defender at same slot, fallback to last alive
        tIdx = Math.min(entry.idx, def.length - 1);
        while (tIdx >= 0 && def[tIdx].count <= 0) tIdx--;
        if (tIdx < 0) continue;
        tSideArr = def;
        tSideKey = 'def';
      } else {
        // Defender targets combined atk+ally: same slot index, random if both alive
        let si = entry.idx;
        tIdx = -1;
        tSideArr = atk;
        tSideKey = 'atk';
        while (si >= 0 && tIdx < 0) {
          const atkHere = si < atk.length && atk[si].count > 0;
          const allyHere = ally && si < ally.length && ally[si].count > 0;
          if (atkHere && allyHere) {
            if (Math.random() < 0.5) { tSideArr = atk; tSideKey = 'atk'; }
            else                     { tSideArr = ally!; tSideKey = 'ally'; }
            tIdx = si;
          } else if (atkHere) {
            tSideArr = atk; tSideKey = 'atk'; tIdx = si;
          } else if (allyHere) {
            tSideArr = ally!; tSideKey = 'ally'; tIdx = si;
          }
          si--;
        }
        if (tIdx < 0) continue;
      }

      // Primary attack
      let dmg = rollSlotDamage(mySlot);
      if (isAtkSide && atkDamageMult !== 1.0) dmg = Math.max(1, Math.floor(dmg * atkDamageMult));
      if (!(godMode && isAtkSide)) {
        tSideArr[tIdx] = applyDamageToSlot(tSideArr[tIdx], dmg);
      }

      // Retaliation
      const retKey = tSideKey + '-' + tIdx;
      const attackerClass = mySlot.unit.combatClass;
      const targetUnit = tSideArr[tIdx].unit;
      const classMatch = targetUnit.universal || targetUnit.combatClass === attackerClass;
      const canRetaliate = !retaliated.has(retKey) && tSideArr[tIdx].count > 0 && classMatch;
      let retDmg = 0;
      if (canRetaliate) {
        retaliated.add(retKey);
        retDmg = rollSlotDamage(tSideArr[tIdx]);
        if (!(godMode && isAtkSide)) {
          mySide[entry.idx] = applyDamageToSlot(mySide[entry.idx], retDmg);
        }
      }

      // Visual slot indices (attacker uses posMap 0-4, ally uses 5+posMapAlly, defender compact)
      let myVisIdx: number;
      if (entry.side === 'attacker') myVisIdx = posMap[entry.idx];
      else if (entry.side === 'ally') myVisIdx = 5 + posMapAlly[entry.idx];
      else myVisIdx = entry.idx;

      let tVisIdx: number;
      if (tSideKey === 'atk') tVisIdx = posMap[tIdx];
      else if (tSideKey === 'ally') tVisIdx = 5 + posMapAlly[tIdx];
      else tVisIdx = tIdx;

      events.push({
        roundNumber,
        side: isAtkSide ? 'attacker' : 'defender',
        mySlotIdx: myVisIdx,
        targetSlotIdx: tVisIdx,
        damage: dmg,
        retaliationDamage: retDmg,
        atkSnaps: positionedAtkSnaps(),
        defSnaps: snapshots(def),
      });
    }
  }

  const atkAlive  = atk.filter(s => s.count > 0);
  const allyAlive = ally ? ally.filter(s => s.count > 0) : [];
  const defAlive  = def.filter(s => s.count > 0);
  const anyAtkAlive = atkAlive.length > 0 || allyAlive.length > 0;
  const draw = anyAtkAlive && defAlive.length > 0;
  return {
    events,
    initialAtkSnaps,
    initialDefSnaps,
    totalRounds: roundNumber,
    attackerWon: !draw && anyAtkAlive && defAlive.length === 0,
    attackersLeft: draw ? [] : atkAlive,
    defendersLeft: draw ? [] : defAlive,
    allyLeft: draw ? [] : allyAlive,
  };
}

// ── Income ───────────────────────────────────────────────────────────────────

export function calcSourceIncome(
  p: GamePlayer,
  board: GameState['board']
): { wood: number; stone: number; gold: number } {
  let wood = 0, stone = 0, gold = 0;
  for (const cell of board) {
    if (cell.owner === p.id && cell.type === 'resource') {
      if (cell.resourceType === 'wood')  wood  += 2;
      if (cell.resourceType === 'stone') stone += 2;
      if (cell.resourceType === 'gold')  gold  += 2;
    }
  }
  if (p.artifacts.some((a: Artifact) => a.slot === 'medallion')) {
    wood  = Math.ceil(wood  * 1.5);
    stone = Math.ceil(stone * 1.5);
    gold  = Math.ceil(gold  * 1.5);
  }
  return { wood, stone, gold };
}

export function applyIncome(state: GameState): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];

  p.resources.wood  += 1;
  p.resources.stone += 1;
  p.resources.gold  += 1;

  const src = calcSourceIncome(p, s.board);
  p.resources.wood  += src.wood;
  p.resources.stone += src.stone;
  p.resources.gold  += src.gold;

  const srcNote = (src.wood + src.stone + src.gold) > 0 ? ' + источники' : '';
  s.log.push(`${p.name}: доход +1🪵 +1🪨 +1💰${srcNote}`);
  return s;
}

export function applyOwnCellIncome(state: GameState, cellIndex: number): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const cell = s.board[cellIndex];
  if (!cell || cell.type !== 'resource' || cell.owner !== p.id) return s;

  let wood = 0, stone = 0, gold = 0;
  if (cell.resourceType === 'wood')  wood  = 2;
  if (cell.resourceType === 'stone') stone = 2;
  if (cell.resourceType === 'gold')  gold  = 2;

  if (p.artifacts.some((a: Artifact) => a.slot === 'medallion')) {
    wood  = Math.ceil(wood  * 1.5);
    stone = Math.ceil(stone * 1.5);
    gold  = Math.ceil(gold  * 1.5);
  }

  p.resources.wood  += wood;
  p.resources.stone += stone;
  p.resources.gold  += gold;
  s.log.push(`${p.name} попал на свою клетку — доп. доход!`);
  return s;
}

// ── Hire ─────────────────────────────────────────────────────────────────────

export function rearrangeArmy(
  state: GameState,
  fromIdx: number,
  toIdx: number,
  count: number  // units to move from fromIdx to toIdx
): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const slots = p.army as (ArmySlot | null)[];

  const from = slots[fromIdx];
  const to   = slots[toIdx];
  if (!from || count <= 0) return s;

  if (!to) {
    if (count >= from.count) {
      slots[toIdx]   = from;
      slots[fromIdx] = null;
    } else {
      slots[toIdx]   = { unit: { ...from.unit }, count };
      slots[fromIdx] = { ...from, count: from.count - count };
    }
  } else if (from.unit.name === to.unit.name) {
    const newFrom = from.count - count;
    slots[fromIdx] = newFrom > 0 ? { ...from, count: newFrom } : null;
    slots[toIdx]   = { ...to, count: to.count + count };
  } else {
    slots[fromIdx] = to;
    slots[toIdx]   = from;
  }

  return s;
}

type SlotLoc = { kind: 'army' } | { kind: 'garrison'; cellIndex: number };

export function transferUnits(
  state: GameState,
  from: SlotLoc, fromIdx: number,
  to: SlotLoc,   toIdx: number,
  count: number
): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];

  const getSlots = (loc: SlotLoc): (ArmySlot | null)[] => {
    if (loc.kind === 'army') return p.army;
    const cell = s.board[loc.cellIndex];
    if (!cell.playerGarrison) cell.playerGarrison = Array(5).fill(null);
    return cell.playerGarrison;
  };

  const fromSlots = getSlots(from);
  const toSlots   = getSlots(to);
  const fromSlot  = fromSlots[fromIdx];
  const toSlot    = toSlots[toIdx];
  if (!fromSlot || count <= 0) return s;

  if (!toSlot) {
    if (count >= fromSlot.count) { toSlots[toIdx] = fromSlot; fromSlots[fromIdx] = null; }
    else { toSlots[toIdx] = { unit: { ...fromSlot.unit }, count }; fromSlots[fromIdx] = { ...fromSlot, count: fromSlot.count - count }; }
  } else if (fromSlot.unit.name === toSlot.unit.name) {
    const newFrom = fromSlot.count - count;
    fromSlots[fromIdx] = newFrom > 0 ? { ...fromSlot, count: newFrom } : null;
    toSlots[toIdx] = { ...toSlot, count: toSlot.count + count };
  } else {
    fromSlots[fromIdx] = toSlot;
    toSlots[toIdx] = fromSlot;
  }
  return s;
}

export function hireUnit(state: GameState, poolIndex: number): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const slot = s.hirePool[poolIndex];

  const usingBonus = s.hireUsed && p.hireBonusCount > 0;
  if (s.hireUsed && !usingBonus) return s;
  if (!slot) return s;

  const totalCost = {
    wood:  slot.unit.cost.wood  * slot.count,
    stone: slot.unit.cost.stone * slot.count,
    gold:  slot.unit.cost.gold  * slot.count,
  };
  if (!canAfford(p.resources, totalCost)) return s;

  const existingIdx = p.army.findIndex(a => a !== null && a.unit.name === slot.unit.name);
  const emptyIdx    = p.army.findIndex(a => a === null);
  if (existingIdx === -1 && emptyIdx === -1) return s;

  p.resources.wood  -= totalCost.wood;
  p.resources.stone -= totalCost.stone;
  p.resources.gold  -= totalCost.gold;

  if (existingIdx !== -1) {
    (p.army[existingIdx] as ArmySlot).count += slot.count;
  } else {
    p.army[emptyIdx] = { unit: { ...slot.unit }, count: slot.count };
  }

  s.hirePool[poolIndex] = makeHireSlot();
  if (usingBonus) p.hireBonusCount--;
  else s.hireUsed = true;
  s.log.push(`${p.name} нанял ${slot.count}× ${slot.unit.name}`);
  return s;
}

export const REFRESH_POOL_COST = 5;

export function refreshHirePool(state: GameState): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  p.resources.wood  -= REFRESH_POOL_COST;
  p.resources.stone -= REFRESH_POOL_COST;
  p.resources.gold  -= REFRESH_POOL_COST;
  s.hirePool = Array.from({ length: 4 }, () => makeHireSlot());
  s.log.push(`${p.name} обновил пул найма (-${REFRESH_POOL_COST}🪵 -${REFRESH_POOL_COST}🪨 -${REFRESH_POOL_COST}💰)`);
  return s;
}

// ── Dice & Movement ──────────────────────────────────────────────────────────

export function rollDice(hasRing: boolean): number {
  const d6 = () => Math.floor(Math.random() * 6) + 1;
  return d6() + d6() + (hasRing ? 1 : 0);
}

export function submitInitRoll(state: GameState, playerId: string, roll: number): GameState {
  const s = clone(state);
  if (!s.initRolls) s.initRolls = {};
  s.initRolls[playerId] = roll;
  const name = s.players.find(p => p.id === playerId)?.name ?? playerId;
  s.log.push(`${name} бросил: ${roll}`);
  return s;
}

export function startGame(state: GameState): GameState {
  const s = clone(state);
  const rolls = s.initRolls ?? {};
  s.players.sort((a, b) => {
    const diff = (rolls[b.id] ?? 0) - (rolls[a.id] ?? 0);
    return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
  });
  s.log.push(`Очерёдность: ${s.players.map(p => `${p.name} (${rolls[p.id] ?? '?'})`).join(' → ')}`);
  delete s.initRolls;
  s.currentPlayerIndex = 0;
  s.phase = 'roll';
  s.log.push(`─── Ход 1: ходит ${s.players[0].name} ───`);
  return applyIncome(s);
}

export const MAX_MANA = 10;

export function movePlayer(state: GameState, roll: number): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const startPos = p.position;
  p.position = (startPos + roll) % 28;
  s.lastRoll = roll;
  s.log.push(`${p.name} бросил кубик: ${roll}, переместился на клетку ${p.position}`);

  // Heal army and restore mana when passing through (or stopping at) own city.
  for (let step = 1; step <= roll; step++) {
    const cellIdx = (startPos + step) % 28;
    const cell = s.board[cellIdx];
    if (cell.type === 'start' && cell.owner === p.id) {
      p.army = p.army.map(slot =>
        slot ? { ...slot, unit: { ...slot.unit, hp: slot.unit.maxHp } } : null
      );
      p.mana = MAX_MANA;
      s.log.push(`${p.name} прошёл через свой город — армия исцелена, мана восстановлена`);
      break;
    }
  }

  return s;
}

// ── Events ───────────────────────────────────────────────────────────────────

const EVENT_NAMES = ['wind', 'bandits', 'find', 'deserter', 'blessing'] as const;
type EventType = typeof EVENT_NAMES[number];

// Step 1: pick the event and store its parameters in pendingEvent — no side effects yet.
export function prepareEvent(state: GameState): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const event = pickRandom([...EVENT_NAMES]) as EventType;
  const ev: PendingEvent = { name: '' };

  switch (event) {
    case 'wind':
      ev.name = '🌬 Попутный ветер';
      ev.moveDelta = 3;
      break;
    case 'bandits': {
      ev.name = '🗡 Налёт разбойников';
      const taken = { wood: 0, stone: 0, gold: 0 };
      for (let i = 0; i < 2; i++) {
        const available = (['wood', 'stone', 'gold'] as const).filter(r => p.resources[r] - taken[r] > 0);
        if (available.length > 0) taken[pickRandom(available)]++;
      }
      if (taken.wood)  ev.wood  = -taken.wood;
      if (taken.stone) ev.stone = -taken.stone;
      if (taken.gold)  ev.gold  = -taken.gold;
      break;
    }
    case 'find': {
      const r = pickRandom(['wood', 'stone', 'gold'] as const);
      ev.name = '💎 Находка';
      ev[r] = 3;
      break;
    }
    case 'deserter': {
      ev.name = '🏳 Дезертир';
      const lastIdx = p.army.reduce((best, sl, i) => sl !== null ? i : best, -1);
      ev.deserterUnit = lastIdx >= 0 ? (p.army[lastIdx] as ArmySlot).unit.name : null;
      break;
    }
    case 'blessing':
      ev.name = '✨ Благословение';
      ev.scoreDelta = 2;
      break;
  }

  s.pendingEvent = ev;
  return s;
}

// Step 2: apply the effects stored in pendingEvent — called when the player clicks «Продолжить».
export function commitEvent(state: GameState): GameState {
  const s = clone(state);
  const ev = s.pendingEvent;
  if (!ev) return s;
  const p = s.players[s.currentPlayerIndex];

  if (ev.moveDelta) {
    p.position = (p.position + ev.moveDelta) % 28;
    s.log.push(`🌬 Попутный ветер! +${ev.moveDelta} шага → клетка ${p.position}`);
  }

  const resDelta = (ev.wood ?? 0) + (ev.stone ?? 0) + (ev.gold ?? 0);
  if (ev.wood  != null) p.resources.wood  = Math.max(0, p.resources.wood  + ev.wood);
  if (ev.stone != null) p.resources.stone = Math.max(0, p.resources.stone + ev.stone);
  if (ev.gold  != null) p.resources.gold  = Math.max(0, p.resources.gold  + ev.gold);
  if (resDelta < 0) {
    s.log.push(`🗡 Налёт разбойников! -${Math.abs(resDelta)} ресурса`);
  } else if (resDelta > 0) {
    const r = (ev.wood ?? 0) > 0 ? 'wood' : (ev.stone ?? 0) > 0 ? 'stone' : 'gold';
    s.log.push(`💎 Находка! +3 ${r}`);
  }

  if (ev.deserterUnit !== undefined) {
    if (ev.deserterUnit !== null) {
      const lastIdx = p.army.reduce((best, sl, i) => sl !== null ? i : best, -1);
      if (lastIdx >= 0) {
        const last = p.army[lastIdx] as ArmySlot;
        if (last.count > 1) last.count--;
        else p.army[lastIdx] = null;
        s.log.push(`🏳 Дезертир — потерян 1× ${ev.deserterUnit}`);
      }
    } else {
      s.log.push(`🏳 Дезертир — армия пуста`);
    }
  }

  if (ev.scoreDelta) {
    p.score += ev.scoreDelta;
    s.log.push(`✨ Благословение! +2 очка`);
  }

  return s;
}

// ── Cell actions (2-step: start → visualize → resolve) ───────────────────────

export function startCapture(state: GameState, cellIndex: number): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const cell = s.board[cellIndex];

  // Player-owned cell: fight playerGarrison; neutral cell: fight initial garrison
  const defenders: ArmySlot[] = cell.owner
    ? (cell.playerGarrison ?? []).filter((sl): sl is ArmySlot => sl !== null)
    : (cell.garrison ?? []);

  if (!defenders.length) {
    cell.owner = p.id;
    cell.playerGarrison = Array(5).fill(null);
    p.score += 1;
    s.phase = 'free';
    s.log.push(`${p.name} захватил источник на клетке ${cellIndex} (без охраны) +1★`);
    return s;
  }

  const sim = simulateCombat(applyArtifactBonuses(p.army, p.artifacts), defenders, s.godMode);
  s.combatData = { ...sim, cellIndex, combatType: 'resource' };
  s.phase = 'combat';
  s.log.push(`${p.name} атакует источник на клетке ${cellIndex}`);
  return s;
}

export function requestJointBattle(
  state: GameState,
  toId: string,
  cellIndex: number,
  combatType: JointRequest['combatType']
): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const ally = s.players.find(pl => pl.id === toId)!;
  s.phase = 'joint_request';
  s.jointRequest = { from: p.id, to: toId, cellIndex, combatType };
  s.log.push(`${p.name} запрашивает помощь у ${ally.name}`);
  return s;
}

export function acceptJoint(state: GameState): GameState {
  const s = clone(state);
  const req = s.jointRequest!;
  const attacker = s.players.find(p => p.id === req.from)!;
  const ally     = s.players.find(p => p.id === req.to)!;
  const cell = s.board[req.cellIndex];

  const defenders: ArmySlot[] = req.combatType === 'dungeon'
    ? (cell.garrison ?? [])
    : cell.owner
      ? (cell.playerGarrison ?? []).filter((sl): sl is ArmySlot => sl !== null)
      : (cell.garrison ?? []);

  const mult = req.combatType === 'city' ? 0.5 : 1.0;
  const sim = simulateCombat(
    applyArtifactBonuses(attacker.army, attacker.artifacts),
    defenders,
    s.godMode,
    applyArtifactBonuses(ally.army, ally.artifacts),
    mult
  );
  s.combatData = { ...sim, cellIndex: req.cellIndex, combatType: req.combatType, allyPlayerId: req.to };
  delete s.jointRequest;
  s.phase = 'combat';
  s.log.push(`${ally.name} принял приглашение — начинается совместный бой`);
  return s;
}

export function declineJoint(state: GameState): GameState {
  const s = clone(state);
  const req = s.jointRequest!;
  const ally = s.players.find(p => p.id === req.to)!;
  s.log.push(`${ally.name} отказал в помощи`);
  delete s.jointRequest;
  s.phase = 'cell';
  return s;
}

export function grantCityHireBonus(state: GameState): GameState {
  const s = clone(state);
  s.players[s.currentPlayerIndex].hireBonusCount++;
  return s;
}

export function startCityCapture(state: GameState, cellIndex: number): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const cell = s.board[cellIndex];

  const defenders: ArmySlot[] = cell.owner
    ? (cell.playerGarrison ?? []).filter((sl): sl is ArmySlot => sl !== null)
    : (cell.garrison ?? []);

  if (!defenders.length) {
    cell.owner = p.id;
    cell.playerGarrison = Array(5).fill(null);
    s.phase = 'free';
    s.log.push(`${p.name} захватил ${cell.name ?? 'город'} (без охраны)`);
    return s;
  }

  const sim = simulateCombat(applyArtifactBonuses(p.army, p.artifacts), defenders, s.godMode, undefined, 0.5);
  s.combatData = { ...sim, cellIndex, combatType: 'city' };
  s.phase = 'combat';
  s.log.push(`${p.name} атакует ${cell.name ?? 'город'}`);
  return s;
}

export function startDungeon(state: GameState, cellIndex: number): GameState {
  const s = clone(state);
  const p = s.players[s.currentPlayerIndex];
  const cell = s.board[cellIndex];

  if (!cell.garrison?.length || cell.dungeonCleared) {
    s.phase = 'free';
    return s;
  }

  const sim = simulateCombat(applyArtifactBonuses(p.army, p.artifacts), cell.garrison, s.godMode);
  s.combatData = { ...sim, cellIndex, combatType: 'dungeon' };
  s.phase = 'combat';
  s.log.push(`${p.name} входит в данж на клетке ${cellIndex}`);
  return s;
}

export function resolveCombat(state: GameState): GameState {
  const s = clone(state);
  const data = s.combatData;
  if (!data) { s.phase = 'free'; return s; }

  const p = s.players[s.currentPlayerIndex];
  const cell = s.board[data.cellIndex];

  // Mutual destruction (both armies wiped): win vs neutrals, loss vs another player's cell.
  const mutualDestruction = !data.attackerWon &&
    data.attackersLeft.length === 0 && data.defendersLeft.length === 0;
  const isPlayerOwnedCell = (data.combatType === 'resource' || data.combatType === 'city') && !!cell.owner && cell.owner !== p.id;
  const effectiveWin = data.attackerWon || (mutualDestruction && !isPlayerOwnedCell);

  if (effectiveWin) {
    // Restore survivors (empty array in mutual-destruction case → army wiped to null).
    const survivors = [...data.attackersLeft];
    p.army = p.army.map(slot => {
      if (!slot) return null;
      const idx = survivors.findIndex(sv => sv.unit.name === slot.unit.name);
      if (idx === -1) return null;
      return survivors.splice(idx, 1)[0];
    });
    if (data.combatType === 'city') {
      cell.owner = p.id;
      cell.garrison = [];
      cell.playerGarrison = Array(5).fill(null);
      s.log.push(`${p.name} захватил ${cell.name ?? 'город'}!`);
    } else if (data.combatType === 'resource') {
      cell.owner = p.id;
      cell.garrison = [];
      cell.playerGarrison = Array(5).fill(null);
      p.score += 1;
      s.log.push(`${p.name} захватил источник на клетке ${data.cellIndex}! +1★`);
    } else {
      cell.garrison = [];
      cell.dungeonCleared = true;
      const reward = cell.dungeonReward;
      if (reward) {
        p.resources.wood  += reward.resources.wood;
        p.resources.stone += reward.resources.stone;
        p.resources.gold  += reward.resources.gold;
        p.score += reward.score;
        if (reward.artifact && !p.artifacts.some((a: Artifact) => a.slot === reward.artifact!.slot)) {
          p.artifacts.push(reward.artifact);
          s.log.push(`${p.name} получил артефакт: ${reward.artifact.name}`);
        }
      }
      s.log.push(`${p.name} победил в данже! +${reward?.score ?? 0}★`);
    }
    // Restore ally survivors on win
    if (data.allyPlayerId && data.allyLeft) {
      const allyPlayer = s.players.find(pl => pl.id === data.allyPlayerId)!;
      const allyRaw = [...data.allyLeft];
      allyPlayer.army = allyPlayer.army.map(slot => {
        if (!slot) return null;
        const idx = allyRaw.findIndex(sv => sv.unit.name === slot.unit.name);
        if (idx === -1) return null;
        return allyRaw.splice(idx, 1)[0];
      });
    }
  } else {
    p.army = Array(5).fill(null);
    s.log.push(`${p.name} потерпел поражение`);

    // Wipe ally army too on loss
    if (data.allyPlayerId) {
      const allyPlayer = s.players.find(pl => pl.id === data.allyPlayerId)!;
      allyPlayer.army = Array(5).fill(null);
    }

    const ownedCities = s.board.filter(c => c.type === 'start' && c.owner === p.id);
    if (ownedCities.length === 0) {
      s.log.push(`${p.name} потерял все замки и выбывает из игры`);
      delete s.combatData;
      return surrender(s, p.id);
    }
    const circDist = (a: number, b: number) => Math.min(Math.abs(a - b), 28 - Math.abs(a - b));
    const nearest = ownedCities.reduce((best, c) =>
      circDist(c.index, p.position) < circDist(best.index, p.position) ? c : best
    );
    p.position = nearest.index;
    s.log.push(`${p.name} отступает в ${nearest.name ?? 'замок'}`);
  }

  delete s.combatData;
  s.phase = 'free';
  return s;
}

// ── Trading ──────────────────────────────────────────────────────────────────

export function executeTrade(state: GameState, offer: TradeOffer): GameState {
  const s = clone(state);
  const from = s.players.find(p => p.id === offer.from)!;
  const to   = s.players.find(p => p.id === offer.to)!;

  from.resources.wood  -= offer.give.wood;  to.resources.wood  += offer.give.wood;
  from.resources.stone -= offer.give.stone; to.resources.stone += offer.give.stone;
  from.resources.gold  -= offer.give.gold;  to.resources.gold  += offer.give.gold;
  to.resources.wood    -= offer.want.wood;  from.resources.wood  += offer.want.wood;
  to.resources.stone   -= offer.want.stone; from.resources.stone += offer.want.stone;
  to.resources.gold    -= offer.want.gold;  from.resources.gold  += offer.want.gold;

  for (const idx of offer.give.cellIndices) { const c = s.board[idx]; if (c) c.owner = to.id; }
  for (const idx of offer.want.cellIndices) { const c = s.board[idx]; if (c) c.owner = from.id; }
  for (const aid of offer.give.artifactIds) { const i = from.artifacts.findIndex(a => a.id === aid); if (i !== -1) to.artifacts.push(...from.artifacts.splice(i, 1)); }
  for (const aid of offer.want.artifactIds) { const i = to.artifacts.findIndex(a => a.id === aid); if (i !== -1) from.artifacts.push(...to.artifacts.splice(i, 1)); }

  for (const type of (offer.give.promises ?? [])) {
    const pr: GamePromise = { type, from: offer.from, to: offer.to, turnCreated: s.turnNumber };
    from.promises.push(pr);
    to.promises.push(pr);
  }
  for (const type of (offer.want.promises ?? [])) {
    const pr: GamePromise = { type, from: offer.to, to: offer.from, turnCreated: s.turnNumber };
    from.promises.push(pr);
    to.promises.push(pr);
  }

  delete s.pendingOffer;
  s.log.push(`🤝 ${from.name} и ${to.name} заключили сделку`);
  return s;
}

export function rejectTrade(state: GameState): GameState {
  const s = clone(state);
  const offer = s.pendingOffer;
  if (offer) {
    s.log.push(`❌ ${s.players.find(p => p.id === offer.to)?.name} отклонил предложение от ${s.players.find(p => p.id === offer.from)?.name}`);
  }
  delete s.pendingOffer;
  return s;
}

// ── Surrender ─────────────────────────────────────────────────────────────────

export function surrender(state: GameState, playerId: string): GameState {
  let s = clone(state);
  const player = s.players.find(p => p.id === playerId);
  if (!player || player.surrendered) return s;

  player.surrendered = true;
  player.army = Array(5).fill(null);
  for (const cell of s.board) {
    if (cell.owner === playerId) {
      delete cell.owner;
      cell.playerGarrison = undefined;
    }
  }
  s.log.push(`🏳 ${player.name} сдался`);

  if (s.players[s.currentPlayerIndex].id === playerId) s = advanceTurn(s);
  return s;
}

// ── Turn advance ─────────────────────────────────────────────────────────────

export function advanceTurn(state: GameState): GameState {
  let s = clone(state);
  delete s.pendingEvent;
  let next = (s.currentPlayerIndex + 1) % s.players.length;
  let guard = 0;
  while (s.players[next].surrendered && guard < s.players.length) {
    next = (next + 1) % s.players.length;
    guard++;
  }
  s.currentPlayerIndex = next;
  s.turnNumber++;
  s.hireUsed = false;
  delete s.lastRoll;
  delete s.combatData;

  // Regenerate cleared dungeons at the start of each new player's turn
  const remainingArtifacts = [...ARTIFACT_POOL];
  for (const cell of s.board) {
    if (cell.type === 'dungeon' && cell.dungeonCleared && cell.dungeonDifficulty) {
      cell.dungeonCleared = false;
      cell.garrison = dungeonGuard(cell.dungeonDifficulty);
      cell.dungeonReward = dungeonReward(cell.dungeonDifficulty, remainingArtifacts);
    }
  }

  s = applyIncome(s);
  s.phase = 'roll';
  s.log.push(`─── Ход ${s.turnNumber}: ходит ${s.players[s.currentPlayerIndex].name} ───`);
  return s;
}

// ── Win check ────────────────────────────────────────────────────────────────

export function checkWin(state: GameState): GamePlayer | null {
  const active = state.players.filter(p => !p.surrendered);
  const instant = active.find(p => p.score >= state.winScore);
  if (instant) return instant;

  if (state.turnNumber > state.maxTurns) {
    return active.reduce((best, p) => {
      if (p.score > best.score) return p;
      if (p.score === best.score && totalResources(p.resources) > totalResources(best.resources)) return p;
      return best;
    });
  }
  return null;
}
