import { CSSProperties, useEffect, useMemo, useState } from "react";
import { applyFeeding, applyPlacement } from "../shared/engine/apply";
import { newGame } from "../shared/engine/game";
import { feedDecisionSchema, placementSchema } from "../shared/engine/placements";
import { GameState } from "../shared/engine/types";
import { ReplayPayload } from "../shared/coworld-protocol";
import { GameHeader, HeaderTab } from "./agricogla/header";
import { GlobalView, FeedView, PlayerView } from "./agricogla/views";
import { Scrubber } from "./agricogla/scrubber";
import { ScoreBoard } from "./agricogla/scoreboard";
import { C, F } from "./agricogla/theme";

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

/** Replays are public: hide every hand so card faces never leak. */
function hideHands(state: GameState): GameState {
  const clone = structuredClone(state);
  for (const player of clone.players) {
    player.handOccupations = [];
    player.handMinors = [];
  }
  return clone;
}

const SPEEDS = [
  { label: "0.5×", ms: 1600 },
  { label: "1×", ms: 800 },
  { label: "2×", ms: 400 },
  { label: "4×", ms: 200 },
] as const;

const appStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 16px 8px",
  overflow: "hidden",
  background:
    "radial-gradient(1200px 700px at 50% -10%, rgba(16,22,34,0.82) 0%, rgba(7,9,13,0.92) 55%), url(art/texture-stage.png) center/cover no-repeat, #07090d",
  color: C.ink,
  fontFamily: F.body,
  fontSize: 14,
};

function ReplayViewer({ payload }: { payload: ReplayPayload }) {
  const states = useMemo(() => buildStates(payload), [payload]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedMs, setSpeedMs] = useState<number>(800);
  const [view, setView] = useState<string>("global");
  // Final-scoring modal can be dismissed to keep scrubbing, then reopened.
  const [scoreClosed, setScoreClosed] = useState(false);

  const last = states.length - 1;

  // Autoplay advances one recorded move at a time, then stops at the end.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex((i) => Math.min(last, i + 1)), speedMs);
    return () => clearInterval(timer);
  }, [playing, speedMs, last]);
  useEffect(() => {
    if (index >= last) setPlaying(false);
  }, [index, last]);

  const atEnd = index >= last;
  const state = useMemo(() => hideHands(states[index]!), [states, index]);
  const finished = state.phase === "finished";

  // One scrubber tick per round; each maps to the first move of that round.
  const frames = useMemo(() => {
    const seen = new Set<number>();
    const arr: { round: number; index: number }[] = [];
    states.forEach((s, i) => {
      if (!seen.has(s.round)) {
        seen.add(s.round);
        arr.push({ round: s.round, index: i });
      }
    });
    return arr;
  }, [states]);

  let selRound = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]!.index <= index) selRound = i;
    else break;
  }

  const seekRound = (r: number) => {
    setPlaying(false);
    const clamped = Math.max(0, Math.min(r, frames.length - 1));
    setIndex(frames[clamped]!.index);
  };

  const tabs: HeaderTab[] = [
    { id: "global", label: "GLOBAL" },
    { id: "feed", label: "FEED" },
    ...state.players.map((p) => ({ id: `p${p.idx}`, label: p.name.toUpperCase(), color: p.color as string | undefined, ai: true })),
  ];

  return (
    <div style={appStyle}>
      <GameHeader
        view={view}
        onSelect={setView}
        tabs={tabs}
        round={state.round}
        finished={finished}
        rightSlot={
          <>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", color: C.muted, textTransform: "uppercase" }}>replay</span>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.inkDim, whiteSpace: "nowrap" }}>move {index} / {last}</span>
            <button className="mini" onClick={() => (atEnd ? (setIndex(0), setPlaying(true)) : setPlaying((p) => !p))}>
              {atEnd ? "↻ replay" : playing ? "⏸ pause" : "▶ play"}
            </button>
            <button className="mini" onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }}>⏮ back</button>
            <button className="mini" onClick={() => { setPlaying(false); setIndex((i) => Math.min(last, i + 1)); }}>⏭ step</button>
            <select value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))} title="playback speed">
              {SPEEDS.map((s) => (
                <option key={s.ms} value={s.ms}>{s.label}</option>
              ))}
            </select>
          </>
        }
      />

      {view === "global" && <GlobalView state={state} messages={[]} log={state.log} mySeat={null} />}
      {view === "feed" && <FeedView state={state} messages={[]} log={state.log} mySeat={null} onSend={() => {}} />}
      {view.startsWith("p") && (
        <PlayerView
          viewState={state}
          liveState={state}
          viewSeat={Number(view.slice(1))}
          mySeat={null}
          finished={finished}
          reviewing={true}
          options={null}
          messages={[]}
          onPick={() => {}}
          onSend={() => {}}
          autoOn={false}
          thinking={false}
          guidance=""
          brain=""
          models={[]}
          prompts={[]}
          onToggleAuto={() => {}}
          onGuidance={() => {}}
          onSetBrain={() => {}}
        />
      )}

      {frames.length > 1 && (
        <Scrubber
          frames={frames}
          sel={selRound}
          atLive={atEnd}
          displayRound={state.round}
          msgCountByRound={{}}
          onSeek={seekRound}
          onLive={() => setIndex(last)}
        />
      )}

      {atEnd && finished && !scoreClosed && (
        <ScoreBoard
          state={state}
          onNewGame={() => { setScoreClosed(false); setIndex(0); setPlaying(true); }}
          onClose={() => setScoreClosed(true)}
        />
      )}
    </div>
  );
}

export function ReplayApp() {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Resolve /replay against <base href> so it follows the same path prefix
    // the page is served under (root locally, .../proxy/ behind the hosted
    // replay proxy), then swap http(s) for ws(s).
    const url = new URL("replay", document.baseURI);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    // The hosted replay pod may not be accepting the socket the instant the
    // page loads, so reconnect until we receive the one-shot replay frame.
    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as { type: string; payload: ReplayPayload };
        if (message.type === "replay") {
          done = true;
          setPayload(message.payload);
          ws?.close();
        }
      };
      ws.onclose = () => {
        if (done) return;
        setConnected(false);
        retry = setTimeout(connect, 1000);
      };
    };
    connect();

    return () => {
      done = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  if (!payload) {
    return (
      <div className="loading">
        <h1>⌂ Agricogla — replay</h1>
        <p>{connected ? "loading replay…" : "connecting…"}</p>
      </div>
    );
  }
  return <ReplayViewer payload={payload} />;
}
