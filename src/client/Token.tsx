import { Good } from "../shared/engine/types";
import { GOOD_LABELS } from "./icons";

export const TOKEN_SRC: Record<Good, string> = {
  wood: "/art/token-wood.png",
  clay: "/art/token-clay.png",
  reed: "/art/token-reed.png",
  stone: "/art/token-stone.png",
  grain: "/art/token-grain.png",
  vegetable: "/art/token-vegetable.png",
  food: "/art/token-food.png",
  sheep: "/art/token-sheep.png",
  boar: "/art/token-boar.png",
  cattle: "/art/token-cattle.png",
};

export const STABLE_SRC = "/art/token-stable.png";

export function Token({ good, size = 22 }: { good: Good; size?: number }) {
  return (
    <img
      className="token-img"
      src={TOKEN_SRC[good]}
      alt={GOOD_LABELS[good]}
      title={GOOD_LABELS[good]}
      style={{ height: size }}
    />
  );
}
