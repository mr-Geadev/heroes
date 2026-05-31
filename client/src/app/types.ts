export interface PlayerInfo {
  id: string;
  name: string;
}

// ── Game types ──────────────────────────────────────────────────────────────

export interface Unit {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  damageMin: number;
  damageMax: number;
  cost: { wood: number; stone: number; gold: number };
  combatClass: 'melee' | 'ranged';
  universal?: boolean;
}

export interface ArmySlot {
  unit: Unit;
  count: number;
}

export interface HireSlot {
  unit: Unit;
  count: number;
}

export interface Artifact {
  id: string;
  name: string;
  slot: 'armor' | 'weapon' | 'ring' | 'medallion' | 'extra1' | 'extra2';
  effect: string;
}

export interface DungeonReward {
  resources: { wood: number; stone: number; gold: number };
  artifact?: Artifact;
  score: number;
}

export interface Cell {
  index: number;
  name?: string;
  type: 'start' | 'resource' | 'dungeon' | 'event';
  resourceType?: 'wood' | 'stone' | 'gold';
  owner?: string;
  garrison?: ArmySlot[];
  playerGarrison?: (ArmySlot | null)[];
  dungeonDifficulty?: 'easy' | 'medium' | 'hard';
  dungeonReward?: DungeonReward;
  dungeonCleared?: boolean;
}

export type PromiseType = 'no-attack' | 'help-battle';

export const PROMISE_LABELS: Record<PromiseType, string> = {
  'no-attack':   '🕊 Не нападать 5 ходов',
  'help-battle': '⚔ Помочь в следующем бою',
};

export interface GamePromise {
  type: PromiseType;
  from: string;
  to: string;
  turnCreated: number;
}

export interface TradeSide {
  wood: number;
  stone: number;
  gold: number;
  cellIndices: number[];
  artifactIds: string[];
  promises: PromiseType[];
}

export interface TradeOffer {
  id: string;
  from: string;
  to: string;
  give: TradeSide;
  want: TradeSide;
}

// ── Combat visualization types ────────────────────────────────────────────────

export interface UnitSnap {
  name: string;
  count: number;
  hp: number;
  maxHp: number;
  damageMin: number;
  damageMax: number;
}

export interface CombatEvent {
  roundNumber: number;
  side: 'attacker' | 'defender';
  mySlotIdx: number;
  targetSlotIdx: number;
  damage: number;
  retaliationDamage: number;
  atkSnaps: (UnitSnap | null)[];
  defSnaps: UnitSnap[];
}

export interface CombatData {
  events: CombatEvent[];
  initialAtkSnaps: (UnitSnap | null)[];
  initialDefSnaps: UnitSnap[];
  totalRounds: number;
  attackerWon: boolean;
  cellIndex: number;
  combatType: 'resource' | 'dungeon' | 'city';
  attackersLeft: ArmySlot[];
  defendersLeft: ArmySlot[];
  allyPlayerId?: string;
  allyLeft?: ArmySlot[];
}

export interface JointRequest {
  from: string;
  to: string;
  cellIndex: number;
  combatType: 'resource' | 'dungeon' | 'city';
}

// ── Player & State ────────────────────────────────────────────────────────────

export interface GamePlayer {
  id: string;
  name: string;
  color: string;
  position: number;
  resources: { wood: number; stone: number; gold: number };
  army: (ArmySlot | null)[];
  artifacts: Artifact[];
  score: number;
  mana: number;
  hireBonusCount: number;
  surrendered: boolean;
  promises: GamePromise[];
  promisesKept: number;
  promisesBroken: number;
}

export interface PendingEvent {
  name: string;
  wood?: number;
  stone?: number;
  gold?: number;
  moveDelta?: number;
  deserterUnit?: string | null;
  scoreDelta?: number;
}

export interface GameState {
  board: Cell[];
  players: GamePlayer[];
  currentPlayerIndex: number;
  phase: 'init_roll' | 'roll' | 'cell' | 'joint_request' | 'combat' | 'free' | 'waiting';
  initRolls?: Record<string, number>;
  turnNumber: number;
  hirePool: HireSlot[];
  hireUsed: boolean;
  lastRoll?: number;
  combatData?: CombatData;
  maxTurns: number;
  winScore: number;
  log: string[];
  godMode?: boolean;
  pendingOffer?: TradeOffer;
  pendingEvent?: PendingEvent;
  jointRequest?: JointRequest;
}

// ── WS message types ─────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'room:create';  payload: { playerName: string } }
  | { type: 'room:join';    payload: { code: string; playerName: string } }
  | { type: 'room:rejoin';  payload: { code: string; playerId: string; playerName: string } }
  | { type: 'room:start';   payload: { state: GameState } }
  | { type: 'game:action';  payload: { type: string; payload: unknown } };

export type ServerMessage =
  | { type: 'room:created';       payload: { code: string; playerId: string } }
  | { type: 'room:self';          payload: { playerId: string } }
  | { type: 'room:player_joined'; payload: { players: PlayerInfo[] } }
  | { type: 'room:player_left';   payload: { players: PlayerInfo[] } }
  | { type: 'room:error';         payload: { message: string } }
  | { type: 'game:start';         payload: { state: GameState } }
  | { type: 'game:update';        payload: { type: string; payload: unknown } };
