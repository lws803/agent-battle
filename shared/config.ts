export interface ClassConfig {
  hp: number;
  damageMin?: number;
  damageMax?: number;
}

/** Character class ID (string). Validated at runtime via `isValidClass()`. */
export type CharacterClass = string;

export const CLASSES: Record<CharacterClass, ClassConfig> = {
  warrior: { hp: 150, damageMin: 10, damageMax: 25 },
  mage: { hp: 80, damageMin: 15, damageMax: 35 },
  rogue: { hp: 100, damageMin: 12, damageMax: 28 },
};

export const CLASS_IDS = Object.keys(CLASSES);

export function isValidClass(id: string): id is keyof typeof CLASSES {
  return id in CLASSES;
}

export function getClassHp(id: string): number {
  return isValidClass(id) ? CLASSES[id].hp : CLASSES[CLASS_IDS[0]].hp;
}
