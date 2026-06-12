import { useEffect, useMemo, useState } from "react";
import { applyFeeding, applyPlacement } from "../shared/engine/apply";
import { newGame } from "../shared/engine/game";
import { feedDecisionSchema, placementSchema } from "../shared/engine/placements";
import { GameState } from "../shared/engine/types";
import { ReplayPayload } from "../shared/coworld-protocol";
import { HandSizes } from "../shared/protocol";
import { ActionBoard, RoundTrack } from "./ActionBoard";
import { EventLog } from "./Panels";
import { PlayerPanel, ScoreBoard } from "./PlayerPanel";

/** Re-simulate the whole episode; the engine is deterministic given the
 *  seed, so the recorded decisions reproduce every intermediate state. */
function buildStates(payload: ReplayPayload): GameState[] {
  let state = newGame({
    seed: payload.seed,
    numPlayers: payload.numPlayers,
    names: payload.playerNames,
  });
  const states: GameState[] = [state];
  for (const action of payload.actions) {
    state =
      action.kind === "place"
        ? applyPlacement(state, action.playerIdx, placementSchema.parse(action.placement)).state
        : applyFeeding(state, action.playerIdx, feedDecisionSchema.parse(action.decision)).state;
    states.push(state);
  }
  return states;
}

/** Replays are public: hide every hand, report card backs only. */
function hideHands(state: GameState): { state: GameState; handSizes: HandSizes[] } {
  const clone = structuredClone(state);
  const handSizes: HandSizes[] = [];
  for (const player of clone.players) {
    handSizes.push({
      occupations: player.handOccupations.length,
      minors: player.handMinors.length,
    });
    player.handOccupations = [];
    player.handMinors = [];
  }
  return { state: clone, handSizes };
}

const SPEEDS = [
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
  { label: "4×", ms: 200 },
] as const;

function ReplayViewer({ payload }: { payload: ReplayPayload }) {
  const states = useMemo(() => buildStates(payload), [payload]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedMs, setSpeedMs] = useState<number>(800);

  // Autoplay; when the recorded end is reached, loop back to move 0.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % states.length), speedMs);
    return () => clearInterval(timer);
  }, [playing, speedMs, states.length]);

  const atEnd = index === states.length - 1;
  const { state, handSizes } = useMemo(() => hideHands(states[index]!), [states, index]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <a href="/client/replay">Agricola — replay</a>
        </h1>
        <RoundTrack state={state} />
        <div className="header-status">
          <span className={`phase-badge ${state.phase}`}>
            {state.phase === "finished"
              ? "game over"
              : state.phase === "feeding"
                ? "harvest — feeding"
                : `round ${state.round}`}
          </span>
          <span className="turn-badge">
            move {index} / {states.length - 1}
          </span>
        </div>
        <div className="header-controls">
          <button className="mini" onClick={() => setPlaying((p) => !p)}>
            {playing ? "⏸ pause" : "▶ play"}
          </button>
          <button
            className="mini"
            onClick={() => {
              setPlaying(false);
              setIndex((i) => Math.max(0, i - 1));
            }}
          >
            ⏮ back
          </button>
          <button
            className="mini"
            onClick={() => {
              setPlaying(false);
              setIndex((i) => Math.min(states.length - 1, i + 1));
            }}
          >
            ⏭ step
          </button>
          <select
            className="controller-select"
            value={speedMs}
            onChange={(e) => setSpeedMs(Number(e.target.value))}
            title="playback speed"
          >
            {SPEEDS.map((s) => (
              <option key={s.ms} value={s.ms}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            type="range"
            min={0}
            max={states.length - 1}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
          />
        </div>
      </header>

      <main className="table-view">
        <div className="board-column">
          <ActionBoard state={state} options={null} myTurn={false} onPick={() => {}} />
          <EventLog state={state} />
        </div>
        <div className="farms-column">
          {state.players.map((p) => (
            <PlayerPanel
              key={p.idx}
              state={state}
              player={p}
              handSizes={handSizes[p.idx]}
              controller={undefined}
              isMe={false}
              isActive={
                state.phase === "work"
                  ? state.currentPlayer === p.idx
                  : state.toFeed.includes(p.idx)
              }
              compactFarm
            />
          ))}
        </div>
      </main>

      {atEnd && state.phase === "finished" && <ScoreBoard state={state} />}
    </div>
  );
}

export function ReplayApp() {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/replay`);
    ws.onopen = () => setConnected(true);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as { type: string; payload: ReplayPayload };
      if (message.type === "replay") setPayload(message.payload);
    };
    return () => ws.close();
  }, []);

  if (!payload) {
    return (
      <div className="loading">
        <h1>Agricola — replay</h1>
        <p>{connected ? "loading replay…" : "connecting…"}</p>
      </div>
    );
  }
  return <ReplayViewer payload={payload} />;
}
