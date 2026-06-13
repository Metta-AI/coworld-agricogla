import { useState } from "react";
import { foodNeeded } from "../../shared/engine/apply";
import { cardById } from "../../shared/engine/cards";
import { computePastures } from "../../shared/engine/farmyard";
import { scorePlayer } from "../../shared/engine/scoring";
import { ActionOption } from "../../shared/engine/legal";
import { GameEvent, GameState, PlayerState } from "../../shared/engine/types";
import { ActPromptWire, ChatMessage } from "../../shared/protocol";
import { ActionSpaces } from "./actionSpaces";
import { Autopilot } from "./autopilot";
import { Composer, Message, MessageList } from "./chat";
import { CardView } from "../CardList";
import { Farm } from "../Farm";
import { MiniFarm } from "./miniFarm";
import { C, F, panel, RES_COLOR, sectionHeading } from "./theme";

function Section({ title, children, style, onCollapse }: { title: string; children: React.ReactNode; style?: React.CSSProperties; onCollapse?: () => void }) {
  return (
    <div style={{ minHeight: 0, display: "flex", flexDirection: "column", ...panel, padding: "12px 14px", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
        <h2 style={{ ...sectionHeading, margin: 0, flex: 1 }}>{title}</h2>
        {onCollapse && <RailChevron dir="left" onClick={onCollapse} label="collapse panel" />}
      </div>
      {children}
    </div>
  );
}

/** Small chevron button used to collapse a side rail. */
function RailChevron({ dir, onClick, label }: { dir: "left" | "right"; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        flex: "none",
        width: 22,
        height: 22,
        borderRadius: 6,
        background: C.field,
        border: `1px solid ${C.border}`,
        color: C.muted,
        cursor: "pointer",
        fontSize: 13,
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {dir === "left" ? "‹" : "›"}
    </button>
  );
}

/** Slim strip shown in place of a collapsed side rail; click anywhere to reopen. */
function CollapsedRail({ label, side, onExpand }: { label: string; side: "left" | "right"; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      aria-label={`expand ${label}`}
      title={`expand ${label}`}
      style={{
        ...panel,
        padding: "10px 0",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        color: C.muted,
      }}
    >
      <span style={{ fontSize: 14 }}>{side === "left" ? "›" : "‹"}</span>
      <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: F.mono, fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase" }}>
        {label}
      </span>
    </button>
  );
}

function logColor(type: string): string {
  if (/harvest|feed/.test(type)) return C.ember;
  if (/beg/.test(type)) return C.beg;
  if (/reveal|round|start/.test(type)) return C.cyan;
  if (/breed|birth|newborn|grow/.test(type)) return C.live;
  return C.inkDim;
}

function ActivityLog({ log }: { log: GameEvent[] }) {
  const items = log.slice(-50).reverse();
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
      {items.map((l, i) => (
        <div key={i} style={{ fontFamily: F.mono, fontSize: 10.5, lineHeight: 1.5, color: logColor(l.type) }}>
          R{l.round} · {l.text}
        </div>
      ))}
    </div>
  );
}

// ============ GLOBAL ============
export interface GlobalViewProps {
  state: GameState;
  messages: ChatMessage[];
  log: GameEvent[];
  mySeat: number | null;
}
export function GlobalView({ state, messages, log, mySeat }: GlobalViewProps) {
  return (
    <main style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "370px minmax(0, 1fr) 330px", gap: 12 }}>
      <Section title="Action board" style={{ overflowY: "auto" }}>
        <ActionSpaces state={state} options={null} clickable={false} onPick={() => {}} />
      </Section>

      <section style={{ minHeight: 0, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoRows: "min-content", gap: 10 }}>
        {state.players.map((p) => (
          <MiniFarm key={p.idx} state={state} player={p} />
        ))}
      </section>

      <section style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <Section title="Table talk · DMs visible" style={{ flex: 1.2 }}>
          <MessageList messages={messages.slice(-40)} players={state.players} mySeat={mySeat} empty="The table is quiet." />
        </Section>
        <Section title="Activity" style={{ flex: 1 }}>
          <ActivityLog log={log} />
        </Section>
      </section>
    </main>
  );
}

// ============ FEED ============
export interface FeedViewProps {
  state: GameState;
  messages: ChatMessage[];
  mySeat: number | null;
  onSend: (to: number | null, text: string) => void;
}
export function FeedView({ state, messages, mySeat, onSend }: FeedViewProps) {
  const groups: { round: number; msgs: ChatMessage[] }[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.round === m.round) last.msgs.push(m);
    else groups.push({ round: m.round, msgs: [m] });
  }
  return (
    <main style={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "center" }}>
      <div style={{ width: 740, maxWidth: "100%", minHeight: 0, display: "flex", flexDirection: "column", ...panel, padding: "14px 18px" }}>
        <h2 style={sectionHeading}>Negotiation feed — public broadcasts &amp; DMs</h2>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, paddingRight: 4 }}>
          {groups.map((g) => (
            <div key={g.round} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, padding: "10px 0 4px", borderBottom: `1px solid ${C.borderSoft}`, marginBottom: 4 }}>
                Round {g.round}
              </div>
              {g.msgs.map((m) => (
                <Message key={m.seq} m={m} players={state.players} mySeat={mySeat} textSize={13} />
              ))}
            </div>
          ))}
          {messages.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: "8px 2px" }}>No table talk yet.</div>}
        </div>
        {mySeat !== null && <Composer players={state.players} from={mySeat} onSend={onSend} prefix={`send as ${state.players[mySeat]!.name} · to`} />}
      </div>
    </main>
  );
}

// ============ PLAYER ============
function ResChip({ label, val, color, good }: { label: string; val: number; color: string; good?: string }) {
  return (
    <span title={label} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 11, padding: "4px 10px", borderRadius: 999, background: C.field, border: `1px solid ${C.border}`, color }}>
      {good ? <img src={`art/token-${good}.png`} alt="" style={{ height: 17, width: 17, objectFit: "contain" }} /> : label}
      <b style={{ fontFamily: F.mono }}>{val}</b>
    </span>
  );
}

function capacityOf(player: PlayerState): number {
  const { pastures } = computePastures(player.spaces, player.fences);
  return pastures.reduce((s, p) => s + p.capacity, 0) + 1; // +1 house pet
}

export interface PlayerViewProps {
  viewState: GameState;
  liveState: GameState;
  viewSeat: number;
  mySeat: number | null;
  finished: boolean;
  reviewing: boolean;
  options: ActionOption[] | null;
  messages: ChatMessage[];
  onPick: (spaceId: string) => void;
  onSend: (to: number | null, text: string) => void;
  // autopilot (only meaningful for your own seat)
  autoOn: boolean;
  thinking: boolean;
  guidance: string;
  brain: string;
  prompts: ActPromptWire[];
  onToggleAuto: () => void;
  onGuidance: (text: string) => void;
  onSetBrain: (brain: string) => void;
}
export function PlayerView(props: PlayerViewProps) {
  const { viewState, liveState, viewSeat, mySeat, finished, reviewing, options, messages, onPick, onSend } = props;
  const [inboxOpen, setInboxOpen] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const vp = viewState.players[viewSeat]!;
  const isMine = viewSeat === mySeat;
  const yourTurn = !reviewing && liveState.phase === "work" && liveState.currentPlayer === mySeat && !finished;
  const myLiveTurn = isMine && yourTurn;
  const score = scorePlayer(viewState, vp).total;
  const newborn = vp.family.filter((m) => m.bornRound === viewState.round).length;
  const workersLeft = vp.family.filter((m) => !m.placed).length;
  const animalsTotal = vp.animals.sheep + vp.animals.boar + vp.animals.cattle;
  const played = [...vp.occupations, ...vp.minors, ...vp.majors];

  const boardTitle = isMine
    ? myLiveTurn
      ? "Action board — your turn, pick a space"
      : `Action board — waiting for ${liveState.players[liveState.currentPlayer]?.name ?? "—"}`
    : "Action board";

  return (
    <main style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `${leftOpen ? "350px" : "34px"} minmax(0, 1fr) ${rightOpen ? "330px" : "34px"}`, gap: 12 }}>
      {leftOpen ? (
        <Section title={boardTitle} style={{ overflowY: "auto" }} onCollapse={() => setLeftOpen(false)}>
          <ActionSpaces state={viewState} options={isMine ? options : null} clickable={myLiveTurn} onPick={onPick} />
        </Section>
      ) : (
        <CollapsedRail label="Action board" side="left" onExpand={() => setLeftOpen(true)} />
      )}

      <section style={{ minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", ...panel, border: `1px solid ${vp.color}55` }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: vp.color, boxShadow: `0 0 9px ${vp.color}`, flex: "none" }} />
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 22, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {isMine ? "Your farm" : `${vp.name}'s farm`}
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
            {`${vp.houseMaterial} house · family ${vp.family.length}${newborn ? ` +${newborn} newborn` : ""} · workers left ${workersLeft}`}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ember }}>{score} pts</span>
        </div>

        <div style={{ background: "linear-gradient(180deg, #10150f, #0c100b)", border: "1px solid #26301f", borderRadius: 10, padding: 12, display: "flex", justifyContent: "center" }}>
          <Farm player={vp} />
        </div>

        <div style={{ ...panel, padding: "11px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            <ResChip label="wood" good="wood" val={vp.resources.wood} color={RES_COLOR.wood} />
            <ResChip label="clay" good="clay" val={vp.resources.clay} color={RES_COLOR.clay} />
            <ResChip label="reed" good="reed" val={vp.resources.reed} color={RES_COLOR.reed} />
            <ResChip label="stone" good="stone" val={vp.resources.stone} color={RES_COLOR.stone} />
            <ResChip label="grain" good="grain" val={vp.resources.grain} color={RES_COLOR.grain} />
            <ResChip label="vegetable" good="vegetable" val={vp.resources.vegetable} color={RES_COLOR.vegetable} />
            <ResChip label="food" good="food" val={vp.resources.food} color={RES_COLOR.food} />
            {vp.beggingCards > 0 && <ResChip label="begging" val={vp.beggingCards} color={C.beg} />}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
            <ResChip label="sheep" good="sheep" val={vp.animals.sheep} color={RES_COLOR.sheep} />
            <ResChip label="boar" good="boar" val={vp.animals.boar} color={RES_COLOR.boar} />
            <ResChip label="cattle" good="cattle" val={vp.animals.cattle} color={RES_COLOR.cattle} />
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.muted }}>capacity {animalsTotal}/{capacityOf(vp)}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.cyan }}>feeding due at harvest: {foodNeeded(viewState, vp)} food</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase" }}>improvements</span>
            {played.map((id) => (
              <span key={id} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: C.field, border: "1px solid #3a3122", color: "#e8c87a" }}>
                {cardById(id).name}
              </span>
            ))}
            {played.length === 0 && <span style={{ fontSize: 11, color: C.faint }}>none yet</span>}
          </div>
        </div>

        {isMine && (vp.handOccupations.length > 0 || vp.handMinors.length > 0) && (
          <div style={{ ...panel, padding: "11px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={sectionHeading}>Your hand</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {vp.handOccupations.map((id) => (
                <CardView key={id} cardId={id} small />
              ))}
              {vp.handMinors.map((id) => (
                <CardView key={id} cardId={id} small />
              ))}
            </div>
          </div>
        )}
      </section>

      {rightOpen ? (
        <section style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <RailChevron dir="right" onClick={() => setRightOpen(false)} label="collapse side panel" />
          </div>
        {isMine && (
          <Autopilot
            on={props.autoOn}
            thinking={props.thinking}
            yourTurn={yourTurn}
            finished={finished}
            guidance={props.guidance}
            brain={props.brain}
            onToggle={props.onToggleAuto}
            onGuidance={props.onGuidance}
            onSetBrain={props.onSetBrain}
            prompts={props.prompts}
          />
        )}
        <div
          style={{
            ...panel,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            ...(inboxOpen ? { flex: 1, minHeight: 0 } : { flex: "none" }),
          }}
        >
          <button
            onClick={() => setInboxOpen((o) => !o)}
            aria-expanded={inboxOpen}
            style={{
              ...sectionHeading,
              margin: inboxOpen ? "0 0 10px" : 0,
              display: "flex",
              alignItems: "center",
              gap: 7,
              width: "100%",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 9, transition: "transform .15s", transform: inboxOpen ? "none" : "rotate(-90deg)" }}>▾</span>
            {isMine ? "Inbox — public + your DMs" : `Inbox — ${vp.name}'s private view`}
          </button>
          {inboxOpen && (
            <>
              <MessageList messages={messages.slice(-50)} players={viewState.players} mySeat={mySeat} empty="No messages yet — the table is quiet." />
              {isMine && mySeat !== null && <Composer players={liveState.players} from={mySeat} onSend={onSend} />}
              {!isMine && (
                <div style={{ fontSize: 11, color: C.faint, paddingTop: 8 }}>
                  Observer mode — {vp.name}'s private console. Only they could act here.
                </div>
              )}
            </>
          )}
        </div>
        </section>
      ) : (
        <CollapsedRail label="Autopilot + Inbox" side="right" onExpand={() => setRightOpen(true)} />
      )}
    </main>
  );
}
