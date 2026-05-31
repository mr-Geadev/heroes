import { Artifact, ArmySlot, Cell, DungeonReward } from '../../types';
import { ARTIFACT_POOL, makeUnit } from './units';

type DungeonDifficulty = 'easy' | 'medium' | 'hard';

const TOPONYMS = [
  'Северная', 'Южная', 'Восточная', 'Западная', 'Туманная',
  'Скалистая', 'Дальняя', 'Тёмная', 'Светлая', 'Речная',
  'Марибор', 'Карадас', 'Дарок', 'Эревон', 'Каладор',
  'Синдрел', 'Морвел', 'Элинор', 'Баррок', 'Нивен',
  'Дунбол', 'Авалон', 'Калдор', 'Тирен', 'Азуран',
  'Валдор', 'Серин', 'Флорин', 'Кречет', 'Эланор',
];

function resourceGarrison(): ArmySlot[] {
  const militia = 1 + Math.floor(Math.random() * 3);   // 1–3× Ополченец
  const slots: ArmySlot[] = [{ unit: makeUnit(0), count: militia }];
  if (Math.random() > 0.4) {
    slots.push({ unit: makeUnit(1), count: 1 + Math.floor(Math.random() * 2) }); // 1–2× Лучник
  }
  return slots;
}

function resourcePrefix(resourceType: 'wood' | 'stone' | 'gold'): string {
  if (resourceType === 'wood')  return 'Лесопилка';
  if (resourceType === 'stone') return 'Шахта';
  return 'Прииск';
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomResources(count: number): { wood: number; stone: number; gold: number } {
  const res = { wood: 0, stone: 0, gold: 0 };
  for (let i = 0; i < count; i++) {
    const key = pick(['wood', 'stone', 'gold'] as const);
    res[key]++;
  }
  return res;
}

export function dungeonGuard(difficulty: DungeonDifficulty): ArmySlot[] {
  switch (difficulty) {
    case 'easy':
      return [
        { unit: makeUnit(0), count: 3 },  // 3× Ополченец
        { unit: makeUnit(1), count: 2 },  // 2× Лучник
        { unit: makeUnit(2), count: 1 },  // 1× Рыцарь
      ];
    case 'medium':
      return [
        { unit: makeUnit(0), count: 3 },  // 3× Ополченец
        { unit: makeUnit(1), count: 2 },  // 2× Лучник
        { unit: makeUnit(2), count: 2 },  // 2× Рыцарь
        { unit: makeUnit(4), count: 1 },  // 1× Голем
      ];
    case 'hard':
      return [
        { unit: makeUnit(0), count: 5 },  // 5× Ополченец
        { unit: makeUnit(1), count: 4 },  // 4× Лучник
        { unit: makeUnit(2), count: 2 },  // 2× Рыцарь
        { unit: makeUnit(3), count: 2 },  // 2× Мага
        { unit: makeUnit(4), count: 1 },  // 1× Голем
      ];
  }
}

export function dungeonReward(difficulty: DungeonDifficulty, artifacts: Artifact[]): DungeonReward {
  switch (difficulty) {
    case 'easy':
      return { resources: randomResources(3), score: 1 };
    case 'medium':
      return { resources: randomResources(5), score: 2 };
    case 'hard': {
      const artifact = artifacts.length > 0 ? artifacts.splice(0, 1)[0] : undefined;
      return { resources: randomResources(5), score: 3, artifact };
    }
  }
}

// Maps cell index (0-27) to CSS grid position { row, col } (1-based)
export function cellGridPos(i: number): { row: number; col: number } {
  if (i <= 7)  return { row: 1, col: i + 1 };
  if (i <= 13) return { row: i - 6, col: 8 };
  if (i === 14) return { row: 8, col: 8 };
  if (i <= 20) return { row: 8, col: 8 - (i - 14) };
  if (i === 21) return { row: 8, col: 1 };
  return { row: 8 - (i - 21), col: 1 };
}

export function generateBoard(): Cell[] {
  const cells: Cell[] = new Array(28);

  // Corners = starts
  [0, 7, 14, 21].forEach(i => { cells[i] = { index: i, type: 'start' }; });

  const sides = [
    [1, 2, 3, 4, 5, 6],
    [8, 9, 10, 11, 12, 13],
    [15, 16, 17, 18, 19, 20],
    [22, 23, 24, 25, 26, 27],
  ];

  const difficulties = shuffle<DungeonDifficulty>(['easy', 'easy', 'medium', 'medium', 'medium', 'medium', 'hard', 'hard']);
  let diffIdx = 0;
  const remainingArtifacts = [...ARTIFACT_POOL];
  const namePool = shuffle([...TOPONYMS]);
  let nameIdx = 0;

  sides.forEach((sideIndices) => {
    const shuffled = shuffle([...sideIndices]);
    const [r1, r2, d1, d2, e1, e2] = shuffled;

    const rt1 = pick(['wood', 'stone', 'gold'] as const);
    cells[r1] = {
      index: r1, type: 'resource',
      name: `${resourcePrefix(rt1)} ${namePool[nameIdx++]}`,
      resourceType: rt1,
      garrison: resourceGarrison(),
    };
    const rt2 = pick(['wood', 'stone', 'gold'] as const);
    cells[r2] = {
      index: r2, type: 'resource',
      name: `${resourcePrefix(rt2)} ${namePool[nameIdx++]}`,
      resourceType: rt2,
      garrison: resourceGarrison(),
    };

    const diff1 = difficulties[diffIdx++];
    cells[d1] = {
      index: d1, type: 'dungeon',
      dungeonDifficulty: diff1,
      garrison: dungeonGuard(diff1),
      dungeonReward: dungeonReward(diff1, remainingArtifacts),
      dungeonCleared: false,
    };
    const diff2 = difficulties[diffIdx++];
    cells[d2] = {
      index: d2, type: 'dungeon',
      dungeonDifficulty: diff2,
      garrison: dungeonGuard(diff2),
      dungeonReward: dungeonReward(diff2, remainingArtifacts),
      dungeonCleared: false,
    };

    cells[e1] = { index: e1, type: 'event' };
    cells[e2] = { index: e2, type: 'event' };
  });

  return cells;
}
