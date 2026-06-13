import { useMemo } from "react";
import { computePastures } from "../shared/engine/farmyard";
import { AnimalType, COLS, PlayerState, ROWS, spaceIndex } from "../shared/engine/types";
import { STABLE_SRC, TOKEN_SRC } from "./Token";

const TILE_GRASS = "art/tile-grass.png";
const TILE_FIELD = "art/tile-field.png";
const TILE_ROOM: Record<string, string> = {
  wood: "art/tile-room-wood.png",
  clay: "art/tile-room-clay.png",
  stone: "art/tile-room-stone.png",
};

const CELL = 64;
const GAP = 8;
const PAD = 10;

export interface FarmProps {
  player: PlayerState;
  /** Cells the user may click (build dialogs). */
  selectableCells?: Set<number>;
  selectedCells?: Map<number, string>;
  onCellClick?: (cell: number) => void;
  /** Fence-drawing mode: clickable edges with current plan. */
  fenceMode?: boolean;
  plannedEdges?: Set<string>;
  onEdgeClick?: (edge: string) => void;
  compact?: boolean;
}

function cellXY(cell: number): { x: number; y: number } {
  const r = Math.floor(cell / COLS);
  const c = cell % COLS;
  return { x: PAD + c * (CELL + GAP), y: PAD + r * (CELL + GAP) };
}

interface AnimalPlacementView {
  perPasture: { cells: number[]; type: AnimalType | null; count: number }[];
  loose: Partial<Record<AnimalType, number>>;
}

/** Visual-only animal arrangement: fill pastures greedily, largest first. */
function arrangeAnimals(player: PlayerState): AnimalPlacementView {
  const layout = computePastures(player.spaces, player.fences);
  const remaining: Record<AnimalType, number> = { ...player.animals };
  const pastures = [...layout.pastures].sort((a, b) => b.capacity - a.capacity);
  const perPasture = pastures.map((p) => {
    const type = (Object.keys(remaining) as AnimalType[])
      .filter((t) => remaining[t] > 0)
      .sort((a, b) => remaining[b] - remaining[a])[0];
    if (!type) return { cells: p.cells, type: null, count: 0 };
    const count = Math.min(p.capacity, remaining[type]);
    remaining[type] -= count;
    return { cells: p.cells, type, count };
  });
  return { perPasture, loose: remaining };
}

export function Farm({
  player,
  selectableCells,
  selectedCells,
  onCellClick,
  fenceMode,
  plannedEdges,
  onEdgeClick,
  compact,
}: FarmProps) {
  const width = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
  const height = PAD * 2 + ROWS * CELL + (ROWS - 1) * GAP;
  const layout = useMemo(
    () => computePastures(player.spaces, player.fences),
    [player.spaces, player.fences],
  );
  const animals = useMemo(() => arrangeAnimals(player), [player]);
  const fenceSet = new Set(player.fences);

  const edgeRects: { edge: string; x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = cellXY(spaceIndex(Math.min(r, ROWS - 1), c));
      const yy = r === ROWS ? y + CELL + GAP / 2 : y - GAP / 2;
      edgeRects.push({ edge: `h-${r}-${c}`, x, y: yy - 3, w: CELL, h: 6 });
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS; c++) {
      const { x, y } = cellXY(spaceIndex(r, Math.min(c, COLS - 1)));
      const xx = c === COLS ? x + CELL + GAP / 2 : x - GAP / 2;
      edgeRects.push({ edge: `v-${r}-${c}`, x: xx - 3, y, w: 6, h: CELL });
    }
  }

  const animalForCell = new Map<number, { type: AnimalType; count: number }>();
  for (const p of animals.perPasture) {
    if (p.type && p.count > 0) {
      animalForCell.set(p.cells[0]!, { type: p.type, count: p.count });
    }
  }

  return (
    <svg
      className={`farm${compact ? " compact" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: compact ? width * 0.72 : width, height: compact ? height * 0.72 : height }}
    >
      <rect x="0" y="0" width={width} height={height} rx="10" className="farm-bg" />
      <defs>
        {player.spaces.map((_, i) => {
          const { x, y } = cellXY(i);
          return (
            <clipPath key={i} id={`cell-${player.idx}-${i}`}>
              <rect x={x} y={y} width={CELL} height={CELL} rx="7" />
            </clipPath>
          );
        })}
      </defs>
      {player.spaces.map((sp, i) => {
        const { x, y } = cellXY(i);
        const inPasture = layout.pastureCells.has(i);
        const selectable = selectableCells?.has(i);
        const marker = selectedCells?.get(i);
        const cls =
          sp.kind === "room"
            ? `cell room ${player.houseMaterial}`
            : sp.kind === "field"
              ? "cell field"
              : inPasture
                ? "cell pasture"
                : "cell empty";
        const tile =
          sp.kind === "room"
            ? TILE_ROOM[player.houseMaterial]!
            : sp.kind === "field"
              ? TILE_FIELD
              : TILE_GRASS;
        const animal = animalForCell.get(i);
        return (
          <g
            key={i}
            className={`${cls}${selectable ? " selectable" : ""}`}
            onClick={selectable && onCellClick ? () => onCellClick(i) : undefined}
          >
            <image
              href={tile}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#cell-${player.idx}-${i})`}
            />
            {inPasture && (
              <rect x={x} y={y} width={CELL} height={CELL} rx="7" className="pasture-tint" />
            )}
            <rect x={x} y={y} width={CELL} height={CELL} rx="7" className="cell-frame" />
            {sp.kind === "field" && sp.crop && (
              <>
                <image
                  href={TOKEN_SRC[sp.crop]}
                  x={x + CELL / 2 - 16}
                  y={y + 6}
                  width={32}
                  height={36}
                  preserveAspectRatio="xMidYMid meet"
                />
                <text x={x + CELL / 2} y={y + CELL - 7} className="cell-count">
                  ×{sp.cropCount}
                </text>
              </>
            )}
            {sp.stable && (
              <image
                href={STABLE_SRC}
                x={x + CELL - 26}
                y={y + 3}
                width={24}
                height={26}
                preserveAspectRatio="xMidYMid meet"
              />
            )}
            {animal && (
              <>
                <image
                  href={TOKEN_SRC[animal.type]}
                  x={x + CELL / 2 - 19}
                  y={y + 6}
                  width={38}
                  height={36}
                  preserveAspectRatio="xMidYMid meet"
                />
                <text x={x + CELL / 2} y={y + CELL - 7} className="cell-count">
                  ×{animal.count}
                </text>
              </>
            )}
            {marker && (
              <text x={x + CELL / 2} y={y + CELL / 2 + 7} className="cell-marker">
                {marker}
              </text>
            )}
          </g>
        );
      })}
      {/* Built fences */}
      {edgeRects
        .filter((e) => fenceSet.has(e.edge))
        .map((e) => (
          <rect key={e.edge} x={e.x} y={e.y} width={e.w} height={e.h} rx="3" className="fence" />
        ))}
      {/* Planned fences + clickable edge targets */}
      {fenceMode &&
        edgeRects.map((e) => {
          const planned = plannedEdges?.has(e.edge);
          const built = fenceSet.has(e.edge);
          if (built) return null;
          return (
            <rect
              key={`plan-${e.edge}`}
              x={e.x - 3}
              y={e.y - 3}
              width={e.w + 6}
              height={e.h + 6}
              rx="4"
              className={`fence-target${planned ? " planned" : ""}`}
              onClick={() => onEdgeClick?.(e.edge)}
            />
          );
        })}
    </svg>
  );
}
