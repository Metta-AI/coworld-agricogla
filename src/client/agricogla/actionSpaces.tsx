import { spaceDef } from "../../shared/engine/boards";
import { ActionOption } from "../../shared/engine/legal";
import { GameState, Goods, Good } from "../../shared/engine/types";
import { C, F, RES_COLOR } from "./theme";

/** Maps each action space to a HUD icon — resource spaces reuse the good
 *  tokens, the rest get a dedicated ember action glyph. */
const SPACE_ICON: Record<string, string> = {
  forest: "token-wood", grove: "token-wood", copse: "token-wood",
  clay_pit: "token-clay", hollow: "token-clay",
  reed_bank: "token-reed",
  quarry_stall: "token-stone", r_west_quarry: "token-stone", r_east_quarry: "token-stone",
  grain_seeds: "token-grain",
  r_vegetable: "token-vegetable",
  day_laborer: "token-food", traveling_players: "token-food",
  r_sheep: "token-sheep", r_boar: "token-boar", r_cattle: "token-cattle",
  farm_expansion: "act-build",
  farmland: "act-plow",
  fishing: "act-fish",
  lessons: "act-occupation", lessons_b: "act-occupation",
  meeting_place: "act-startplayer",
  resource_market: "act-market",
  r_improvement: "act-improve",
  r_fences: "act-fence",
  r_sow_bake: "act-sow", r_cultivation: "act-sow",
  r_renovate_improve: "act-renovate", r_redevelop: "act-renovate",
  r_family_growth: "act-family", r_urgent_family: "act-family",
};

function goodsLabel(pile: Goods): { text: string; color: string } {
  const entries = Object.entries(pile).filter(([, n]) => (n ?? 0) > 0) as [Good, number][];
  if (entries.length === 0) return { text: "", color: C.muted };
  const text = entries.map(([g, n]) => `${n} ${g}`).join(" · ");
  return { text, color: entries.length === 1 ? RES_COLOR[entries[0]![0]] : C.inkDim };
}

export interface ActionSpacesProps {
  state: GameState;
  /** Legal options for the viewing seat (drives clickability); null = observer. */
  options: ActionOption[] | null;
  /** True only when it is the viewer's live turn. */
  clickable: boolean;
  onPick: (spaceId: string) => void;
}

export function ActionSpaces({ state, options, clickable, onPick }: ActionSpacesProps) {
  const optById = new Map((options ?? []).map((o) => [o.id, o]));
  // Round cards are appended as they reveal; the last one is this round's.
  const newestRoundCard = [...state.actionSpaces]
    .reverse()
    .find((s) => spaceDef(s.id, state.numPlayers).stage !== undefined)?.id;
  const upcoming = state.roundDeck.length;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        {state.actionSpaces.map((space) => {
          const def = spaceDef(space.id, state.numPlayers);
          const taken = space.occupiedBy !== null;
          const opt = optById.get(space.id);
          const canClick = clickable && !!opt?.available && !taken;
          const isNew = space.id === newestRoundCard && state.round > 0;
          const goods = goodsLabel(space.pile);
          const occupant = taken ? state.players[space.occupiedBy!]! : null;
          return (
            <button
              key={space.id}
              onClick={canClick ? () => onPick(space.id) : undefined}
              title={opt?.reason ?? def.summary}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "flex-start",
                background: taken ? C.field : "linear-gradient(180deg, #1a2030, #141926)",
                border: `1px solid ${
                  canClick ? "#a87a23" : isNew ? "rgba(90,215,255,0.35)" : C.border
                }`,
                borderRadius: 9,
                padding: "8px 10px",
                opacity: taken ? 0.55 : 1,
                cursor: canClick ? "pointer" : "default",
                boxShadow: canClick ? "0 0 12px rgba(255,160,21,0.18)" : "none",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                {SPACE_ICON[space.id] && (
                  <img
                    src={`art/${SPACE_ICON[space.id]}.png`}
                    alt=""
                    style={{ height: 19, width: 19, objectFit: "contain", flex: "none", opacity: taken ? 0.6 : 1 }}
                  />
                )}
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: C.ink,
                    flex: 1,
                    textAlign: "left",
                  }}
                >
                  {def.title}
                </span>
                {isNew && (
                  <span style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: "0.1em", color: C.cyan }}>NEW</span>
                )}
              </span>
              <span style={{ fontSize: 10, color: C.muted, textAlign: "left", width: "100%", lineHeight: 1.35 }}>
                {def.summary}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minHeight: 16 }}>
                <span style={{ fontFamily: F.mono, fontSize: 10.5, fontWeight: 700, color: goods.color }}>
                  {goods.text}
                </span>
                <span style={{ flex: 1 }} />
                {occupant && (
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      flex: "none",
                      background: occupant.color,
                      boxShadow: `0 0 7px ${occupant.color}`,
                    }}
                  />
                )}
                <span style={{ fontSize: 10, color: C.inkDim }}>{occupant?.name ?? ""}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ margin: "10px 2px 0", fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", color: C.faint }}>
        {upcoming > 0
          ? `${upcoming} action card${upcoming > 1 ? "s" : ""} still face-down · next reveals at round ${state.round + 1}`
          : "all action cards revealed"}
      </p>
    </>
  );
}
