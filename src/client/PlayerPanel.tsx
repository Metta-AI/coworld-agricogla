import { scorePlayer } from "../shared/engine/scoring";
import { GameState, PlayerState, RESOURCES } from "../shared/engine/types";
import { Controller, HandSizes } from "../shared/protocol";
import { CardBacks, CardView } from "./CardList";
import { Farm } from "./Farm";
import { Token } from "./Token";

export interface PlayerPanelProps {
  state: GameState;
  player: PlayerState;
  handSizes: HandSizes | undefined;
  controller: Controller | undefined;
  isMe: boolean;
  isActive: boolean;
  onControllerChange?: (c: Controller) => void;
  compactFarm?: boolean;
}

export function PlayerPanel({
  state,
  player,
  handSizes,
  controller,
  isMe,
  isActive,
  onControllerChange,
  compactFarm,
}: PlayerPanelProps) {
  const score = scorePlayer(state, player);
  const workersLeft = player.family.filter((m) => !m.placed).length;
  return (
    <section className={`player-panel${isActive ? " active" : ""}${isMe ? " me" : ""}`}>
      <header className="player-head">
        <span className="player-disc" style={{ background: player.color }} />
        <h2>
          {player.name}
          {player.startingPlayerMarker && (
            <span className="starting-marker" title="starting player">
              ⟡
            </span>
          )}
        </h2>
        <span className="player-score" title="current score if the game ended now">
          {score.total} pts
        </span>
        {onControllerChange ? (
          <select
            className="controller-select"
            value={controller}
            onChange={(e) => onControllerChange(e.target.value as Controller)}
            title="who plays this seat"
          >
            <option value="human">🧑 human</option>
            <option value="scripted">⚙️ autopilot</option>
            <option value="llm">✨ LLM</option>
          </select>
        ) : (
          <span className="controller-label">{controller}</span>
        )}
      </header>

      <div className="player-body">
        <Farm player={player} compact={compactFarm} />
        <div className="player-stats">
          <div className="family-row" title="family members (workers)">
            {player.family.map((m, i) => (
              <span
                key={i}
                className={`family-disc${m.placed ? " placed" : ""}${m.bornRound === state.round ? " newborn" : ""}`}
                style={{ borderColor: player.color }}
              />
            ))}
            {isActive && state.phase === "work" && (
              <span className="turn-note">to place: {workersLeft}</span>
            )}
          </div>
          <div className="resource-row">
            {RESOURCES.map((r) =>
              player.resources[r] > 0 ? (
                <span key={r} className="chip" title={r}>
                  <Token good={r} size={18} />
                  {player.resources[r]}
                </span>
              ) : null,
            )}
            {(["sheep", "boar", "cattle"] as const).map((a) =>
              player.animals[a] > 0 ? (
                <span key={a} className="chip" title={a}>
                  <Token good={a} size={18} />
                  {player.animals[a]}
                </span>
              ) : null,
            )}
            {player.beggingCards > 0 && (
              <span className="chip begging" title="begging cards (-3 each)">
                🥣{player.beggingCards}
              </span>
            )}
          </div>
          <div className="hand-row">
            {isMe ? null : (
              <>
                <CardBacks count={handSizes?.occupations ?? 0} kind="occupation" />
                <CardBacks count={handSizes?.minors ?? 0} kind="minor" />
              </>
            )}
          </div>
          {(player.occupations.length > 0 || player.minors.length > 0 || player.majors.length > 0) && (
            <div className="played-cards">
              {[...player.occupations, ...player.minors, ...player.majors].map((id) => (
                <CardView key={id} cardId={id} small />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ScoreBoard({ state }: { state: GameState }) {
  if (!state.scores) return null;
  const sorted = [...state.scores].sort((a, b) => b.total - a.total);
  return (
    <div className="modal-backdrop">
      <div className="modal scoreboard">
        <h3>Final Scoring</h3>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              {sorted.map((s) => (
                <th key={s.playerIdx}>{state.players[s.playerIdx]!.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted[0]!.categories.map((cat, i) => (
              <tr key={cat.label}>
                <td>{cat.label}</td>
                {sorted.map((s) => (
                  <td key={s.playerIdx} title={s.categories[i]!.detail}>
                    {s.categories[i]!.points}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              {sorted.map((s) => (
                <td key={s.playerIdx}>{s.total}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="winner-line">
          🏆 {state.players[sorted[0]!.playerIdx]!.name} wins with {sorted[0]!.total} points
        </p>
      </div>
    </div>
  );
}
