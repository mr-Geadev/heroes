import { Artifact, HireSlot, Unit } from '../../types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const TEMPLATES: {
  name: string; hp: number; damageMin: number; damageMax: number;
  cost: Unit['cost']; maxStack: number;
  combatClass: Unit['combatClass']; universal?: boolean;
}[] = [
  { name: 'Ополченец', hp: 5,  damageMin: 1, damageMax: 3, cost: { wood: 2, stone: 0, gold: 0 }, maxStack: 5, combatClass: 'melee' },
  { name: 'Лучник',    hp: 3,  damageMin: 2, damageMax: 4, cost: { wood: 0, stone: 2, gold: 0 }, maxStack: 4, combatClass: 'ranged' },
  { name: 'Рыцарь',   hp: 8,  damageMin: 2, damageMax: 4, cost: { wood: 2, stone: 2, gold: 0 }, maxStack: 2, combatClass: 'melee' },
  { name: 'Маг',      hp: 4,  damageMin: 3, damageMax: 7, cost: { wood: 0, stone: 0, gold: 3 }, maxStack: 2, combatClass: 'ranged', universal: true },
  { name: 'Голем',    hp: 12, damageMin: 1, damageMax: 3, cost: { wood: 0, stone: 2, gold: 2 }, maxStack: 1, combatClass: 'melee' },
];

export function makeUnit(index: number): Unit {
  const t = TEMPLATES[index];
  return {
    id: uid(), name: t.name, hp: t.hp, maxHp: t.hp,
    damageMin: t.damageMin, damageMax: t.damageMax,
    cost: { ...t.cost }, combatClass: t.combatClass,
    ...(t.universal ? { universal: true } : {}),
  };
}

export function randomUnit(): Unit {
  return makeUnit(Math.floor(Math.random() * TEMPLATES.length));
}

export function weakUnit(): Unit {
  return makeUnit(Math.random() < 0.5 ? 0 : 1); // ополченец или лучник
}

export function makeHireSlot(): HireSlot {
  const idx = Math.floor(Math.random() * TEMPLATES.length);
  const t = TEMPLATES[idx];
  const count = Math.floor(Math.random() * t.maxStack) + 1;
  return { unit: makeUnit(idx), count };
}

export const ARTIFACT_POOL: Artifact[] = [
  { id: 'armor',     name: 'Кольчуга',         slot: 'armor',    effect: 'Все юниты +2 HP' },
  { id: 'weapon',    name: 'Огненный жезл',    slot: 'weapon',   effect: 'Все юниты +1 урон' },
  { id: 'ring',      name: 'Кольцо удачи',     slot: 'ring',     effect: '+1 к броску кубика' },
  { id: 'medallion', name: 'Медальон мудреца', slot: 'medallion', effect: 'Доход с источников ×1.5' },
  { id: 'extra1',    name: 'Походный рюкзак',  slot: 'extra1',   effect: 'Нанимать 2 юнита за ход' },
];
