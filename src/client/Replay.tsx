import { useEffect, useMemo, useState } from "react";
import { applyFeeding, applyPlacement } from "../shared/engine/apply";
import { newGame } from "../shared/engine/game";
import { feedDecisionSchema, placementSchema } from "../shared/engine/placements";
import { GameState } from "../shared/engine/types";
import { ReplayPayload } from "../shared/coworld-protocol";
import { HandSizes } from "../shared/protocol";
import { FeedView, GlobalView } from "./agricogla/views";
import { ScoreBoard } from "./agricogla/scoreboard";
import { C, F, nextHarvest } from "./agricogla/theme";

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

export function ReplayViewer({ payload }: { payload: ReplayPayload }) {
  const states = useMemo(() => buildStates(payload), [payload]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedMs, setSpeedMs] = useState<number>(800);
  // The replay opens on the negotiation feed; flip to the full table any time.
  const [view, setView] = useState<"feed" | "table">("feed");

  // Autoplay; when the recorded end is reached, loop back to move 0.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % states.length), speedMs);
    return () => clearInterval(timer);
  }, [playing, speedMs, states.length]);

  const atEnd = index === states.length - 1;
  const { state } = useMemo(() => hideHands(states[index]!), [states, index]);
  const nh = nextHarvest(state.round);
  // Reveal table-talk in step with the scrubber (messages are tagged by round).
  const visibleChat = useMemo(
    () => (payload.chat ?? []).filter((m) => m.round <= state.round),
    [payload.chat, state.round],
  );

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", gap: 10, padding: "12px 16px 8px", overflow: "hidden", background: "radial-gradient(1200px 700px at 50% -10%, #101622 0%, #07090d 55%)", color: C.ink, fontFamily: F.body, fontSize: 14 }}>
      <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "2px 4px 10px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flex: "none" }}>
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 27, letterSpacing: "0.05em", textTransform: "uppercase", color: C.ember, textShadow: "0 0 14px rgba(255,160,21,0.45)" }}>⌂</span>
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 27, letterSpacing: "0.05em", textTransform: "uppercase", background: "linear-gradient(90deg, #ffffff, #ffa015)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Agricogla</span>
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", color: C.muted, textTransform: "uppercase" }}>replay</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>Round</span>
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 28, lineHeight: 1 }}>{state.round}/14</span>
        </div>
        <span style={{ fontFamily: F.mono, fontSize: 11, padding: "5px 10px", borderRadius: 999, border: "1px solid #233140", color: C.cyan, whiteSpace: "nowrap" }}>
          {state.phase === "finished" ? "GAME OVER" : nh ? `harvest after R${nh}` : ""}
        </span>
        <div style={{ display: "flex", gap: 6, flex: "none" }}>
          {(["feed", "table"] as const).map((v) => (
            <button
              key={v}
              className="mini"
              onClick={() => setView(v)}
              style={view === v ? { borderColor: C.ember, color: C.ember } : undefined}
            >
              {v === "feed" ? "💬 feed" : "▦ table"}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.inkDim }}>move {index} / {states.length - 1}</span>
          <button className="mini" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ pause" : "▶ play"}</button>
          <button className="mini" onClick={() => { setPlaying(false); setIndex((i) => Math.max(0, i - 1)); }}>⏮ back</button>
          <button className="mini" onClick={() => { setPlaying(false); setIndex((i) => Math.min(states.length - 1, i + 1)); }}>⏭ step</button>
          <select value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))} title="playback speed">
            {SPEEDS.map((s) => (
              <option key={s.ms} value={s.ms}>{s.label}</option>
            ))}
          </select>
          <input type="range" min={0} max={states.length - 1} value={index} onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} style={{ width: 160 }} />
        </div>
      </header>

      {view === "feed" ? (
        <FeedView state={state} messages={visibleChat} mySeat={null} onSend={() => {}} />
      ) : (
        <GlobalView state={state} messages={visibleChat} log={state.log} mySeat={null} />
      )}

      {atEnd && state.phase === "finished" && <ScoreBoard state={state} onNewGame={() => setIndex(0)} />}
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
