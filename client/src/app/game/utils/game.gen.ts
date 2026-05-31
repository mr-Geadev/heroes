import { ArmySlot, GameState, PlayerInfo } from '../../types';
import { generateBoard } from './board.gen';
import { makeHireSlot, makeUnit } from './units';

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const START_POSITIONS = [0, 7, 14, 21];

function playerStartPositions(count: number): number[] {
  if (count >= 4) return [0, 7, 14, 21];
  if (count === 3) return [0, 7, 14];
  if (count === 2) return [0, 14];   // через одну — противоположные углы
  return [0];
}

function strongCityGarrison(): ArmySlot[] {
  return [
    { unit: makeUnit(0), count: 5 },  // 5× Ополченец
    { unit: makeUnit(1), count: 4 },  // 4× Лучник
    { unit: makeUnit(2), count: 2 },  // 2× Рыцарь
    { unit: makeUnit(3), count: 2 },  // 2× Маг
    { unit: makeUnit(4), count: 1 },  // 1× Голем
  ];
}

export function generateGameState(players: PlayerInfo[]): GameState {
  const board = generateBoard();
  const assignedPositions = playerStartPositions(players.length);

  const gamePlayers = players.map((p, i) => ({
    id: p.id,
    name: p.name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    position: assignedPositions[i],
    resources: { wood: 15, stone: 15, gold: 15 },
    army: Array(5).fill(null),
    artifacts: [],
    score: 0,
    mana: 0,
    hireBonusCount: 0,
    surrendered: false,
    promises: [],
    promisesKept: 0,
    promisesBroken: 0,
  }));

  // Assign player cities and garrison unoccupied ones.
  gamePlayers.forEach((p, i) => {
    const idx = assignedPositions[i];
    board[idx].owner = p.id;
    board[idx].name = `Город ${p.name}`;
  });
  START_POSITIONS.filter(idx => !assignedPositions.includes(idx)).forEach(idx => {
    board[idx].name = 'Заброшенный замок';
    board[idx].garrison = strongCityGarrison();
  });

  return {
    board,
    players: gamePlayers,
    currentPlayerIndex: 0,
    phase: 'init_roll',
    turnNumber: 1,
    hirePool: Array.from({ length: 4 }, () => makeHireSlot()),
    hireUsed: false,
    maxTurns: 120,
    winScore: 20,
    log: ['Игра началась! Бросаем кубики для определения очерёдности...'],
    initRolls: {},
  };
}
