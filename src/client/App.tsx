import { useEffect, useRef, useState } from "react";
import { computeAutoFeed } from "../shared/engine/apply";
import { legalActions, playerChoices } from "../shared/engine/legal";
import { Placement } from "../shared/engine/placements";
import { ActionBoard, RoundTrack } from "./ActionBoard";
import { FeedDialog, PlacementDialog } from "./Dialogs";
import { CardView } from "./CardList";
import { EventLog, PromptsPanel } from "./Panels";
import { PlayerPanel, ScoreBoard } from "./PlayerPanel";
import { GameSocket } from "./net";

function routePlayer(): number | null {
  const match = /^\/player\/(\d+)/.exec(location.pathname);
  return match ? Number(match[1]) : null;
}

export function App() {
  const [, setTick] = useState(0);
  const myIdx = routePlayer();
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) {
    socketRef.current = new GameSocket(myIdx, () => setTick((t) => t + 1));
  }
  const socket = socketRef.current;
  useEffect(() => {
    socket.connect();
  }, [socket]);

  const [dialogSpace, setDialogSpace] = useState<string | null>(null);
  const { state, status, handSizes, prompts, lastError, connected } = socket.feed;

  if (!state || !status) {
    return (
      <div className="loading">
        <h1>Agricola</h1>
        <p>{connected ? "waiting for the game…" : "connecting…"}</p>
      </div>
    );
  }

  const me = myIdx !== null ? state.players[myIdx] : null;
  const iAmHuman = myIdx !== null && status.controllers[myIdx] === "human";
  const myTurn =
    iAmHuman && state.phase === "work" && state.currentPlayer === myIdx && !status.finished;
  const myFeed =
    iAmHuman && state.phase === "feeding" && state.toFeed.includes(myIdx!) && !status.finished;

  const options = myIdx !== null ? legalActions(state, myIdx) : null;
  const choices = myIdx !== null ? playerChoices(state, myIdx) : null;

  const submitPlacement = (placement: Placement) => {
    socket.place(placement);
    setDialogSpace(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <a href="/">Agricola</a>
        </h1>
        <RoundTrack state={state} />
        <div className="header-status">
          <span className={`phase-badge ${state.phase}`}>
            {status.finished
              ? "game over"
              : state.phase === "feeding"
                ? "harvest — feeding"
                : `round ${state.round}`}
          </span>
          {!status.finished && state.phase === "work" && (
            <span className="turn-badge" style={{ background: state.players[state.currentPlayer]!.color }}>
              {state.players[state.currentPlayer]!.name}'s turn
            </span>
          )}
          <span className={`conn-dot${connected ? " on" : ""}`} title="connection" />
        </div>
        <nav className="seat-nav">
          <a className={myIdx === null ? "active" : ""} href="/">
            table
          </a>
          {state.players.map((p) => (
            <a
              key={p.idx}
              className={myIdx === p.idx ? "active" : ""}
              href={`/player/${p.idx}`}
              style={{ borderColor: p.color }}
            >
              {p.name}
            </a>
          ))}
        </nav>
        <div className="header-controls">
          <button className="mini" onClick={() => (status.paused ? socket.resume() : socket.pause())}>
            {status.paused ? "▶ resume" : "⏸ pause"}
          </button>
          <button className="mini" onClick={() => socket.reset()} title="new game, next seed">
            ↻ new game
          </button>
        </div>
      </header>

      {lastError && (
        <div className="error-banner" onClick={() => socket.clearError()}>
          ⚠ {lastError} (click to dismiss)
        </div>
      )}
      {myTurn && <div className="your-turn-banner">Your turn — pick an open action space</div>}

      <main className={myIdx === null ? "table-view" : "seat-view"}>
        <div className="board-column">
          <ActionBoard
            state={state}
            options={options}
            myTurn={!!myTurn}
            onPick={(spaceId) => setDialogSpace(spaceId)}
          />
          <EventLog state={state} />
          <PromptsPanel prompts={prompts} state={state} />
        </div>

        <div className="farms-column">
          {state.players.map((p) => (
            <PlayerPanel
              key={p.idx}
              state={state}
              player={p}
              handSizes={handSizes[p.idx]}
              controller={status.controllers[p.idx]}
              isMe={p.idx === myIdx}
              isActive={
                state.phase === "work"
                  ? state.currentPlayer === p.idx && !status.finished
                  : state.toFeed.includes(p.idx)
              }
              onControllerChange={(c) => socket.setController(p.idx, c)}
              compactFarm={myIdx !== null && p.idx !== myIdx}
            />
          ))}
        </div>
      </main>

      {me && (me.handOccupations.length > 0 || me.handMinors.length > 0) && (
        <footer className="hand-footer">
          <h3>Your hand</h3>
          <div className="card-grid">
            {me.handOccupations.map((id) => (
              <CardView key={id} cardId={id} small />
            ))}
            {me.handMinors.map((id) => (
              <CardView key={id} cardId={id} small />
            ))}
          </div>
        </footer>
      )}

      {myTurn && dialogSpace && choices && (
        <PlacementDialog
          spaceId={dialogSpace}
          state={state}
          playerIdx={myIdx!}
          choices={choices}
          onSubmit={submitPlacement}
          onCancel={() => setDialogSpace(null)}
        />
      )}
      {myFeed && choices && (
        <FeedDialog
          state={state}
          playerIdx={myIdx!}
          choices={choices}
          onSubmit={(conversions) => socket.feedDecision({ conversions })}
          onAuto={() => socket.feedDecision(computeAutoFeed(state, myIdx!))}
        />
      )}
      {status.finished && <ScoreBoard state={state} />}
    </div>
  );
}
