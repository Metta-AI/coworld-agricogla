import { Good } from "../shared/engine/types";

export const GOOD_ICONS: Record<Good, string> = {
  wood: "🪵",
  clay: "🧱",
  reed: "🌾",
  stone: "🪨",
  grain: "🌾",
  vegetable: "🥕",
  food: "🍲",
  sheep: "🐑",
  boar: "🐗",
  cattle: "🐄",
};

// Reed and grain need distinct glyphs.
GOOD_ICONS.reed = "🎋";
GOOD_ICONS.grain = "🌾";

export const GOOD_LABELS: Record<Good, string> = {
  wood: "Wood",
  clay: "Clay",
  reed: "Reed",
  stone: "Stone",
  grain: "Grain",
  vegetable: "Vegetable",
  food: "Food",
  sheep: "Sheep",
  boar: "Wild boar",
  cattle: "Cattle",
};
