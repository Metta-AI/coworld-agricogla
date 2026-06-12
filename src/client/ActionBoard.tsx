import { roundCards, spaceDef, stageOfRound, HARVEST_ROUNDS } from "../shared/engine/boards";
import { ActionOption } from "../shared/engine/legal";
import { GameState, Good, Goods } from "../shared/engine/types";
import { Token } from "./Token";

export function GoodsChips({ goods }: { goods: Goods }) {
  const entries = Object.entries(goods).filter(([, n]) => (n ?? 0) > 0);
  if (entries.length === 0) return null;
  return (
    <span className="goods-chips">
      {entries.map(([g, n]) => (
        <span key={g} className="chip" title={g}>
          <Token good={g as Good} size={18} />
          {n}
        </span>
      ))}
    </span>
  );
}

export interface ActionBoardProps {
  state: GameState;
  options: ActionOption[] | null;
  myTurn: boolean;
  onPick: (spaceId: string) => void;
}

export function ActionBoard({ state, options, myTurn, onPick }: ActionBoardProps) {
  const optionById = new Map((options ?? []).map((o) => [o.id, o]));
  const revealedRounds = new Set(state.actionSpaces.map((s) => s.id));
  const upcoming = roundCards.filter((c) => !revealedRounds.has(c.id));

  return (
    <div className="action-board">
      <div className="spaces">
        {state.actionSpaces.map((space) => {
          const def = spaceDef(space.id, state.numPlayers);
          const opt = optionById.get(space.id);
          const occupant = space.occupiedBy !== null ? state.players[space.occupiedBy]! : null;
          const clickable = myTurn && opt?.available;
          const isRound = def.stage !== undefined;
          return (
            <button
              key={space.id}
              className={[
                "space",
                isRound ? "round-card" : "fixed-space",
                occupant ? "occupied" : "",
                clickable ? "clickable" : "",
                myTurn && !opt?.available ? "unavailable" : "",
              ].join(" ")}
              onClick={clickable ? () => onPick(space.id) : undefined}
              title={opt?.reason ?? def.summary}
            >
              <span className="space-title">{def.title}</span>
              <span className="space-summary">{def.summary}</span>
              <GoodsChips goods={space.pile} />
              {occupant && (
                <span className="worker" style={{ background: occupant.color }}>
                  {occupant.name[0]}
                </span>
              )}
            </button>
          );
        })}
        {upcoming.map((card) => (
          <div key={card.id} className="space face-down" title={`Appears in stage ${card.stage}`}>
            <span className="space-title">Stage {card.stage}</span>
            <span className="space-summary">round card</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RoundTrack({ state }: { state: GameState }) {
  return (
    <div className="round-track">
      {Array.from({ length: 14 }, (_, i) => i + 1).map((r) => (
        <span
          key={r}
          className={[
            "round-pip",
            r === state.round ? "current" : "",
            r < state.round ? "past" : "",
            HARVEST_ROUNDS.has(r) ? "harvest" : "",
          ].join(" ")}
          title={`Round ${r}${HARVEST_ROUNDS.has(r) ? " — harvest" : ""} (stage ${stageOfRound(r)})`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}
