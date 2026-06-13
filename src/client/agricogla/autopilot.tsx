import { useEffect, useRef, useState } from "react";
import { ActPromptWire, BEDROCK_MODELS } from "../../shared/protocol";
import { C, F } from "./theme";

export interface AutopilotProps {
  on: boolean;
  thinking: boolean;
  yourTurn: boolean;
  finished: boolean;
  guidance: string;
  model: string;
  onToggle: () => void;
  onGuidance: (text: string) => void;
  onSetModel: (model: string) => void;
  /** Act-prompt transcripts for this seat, newest last. */
  prompts: ActPromptWire[];
}

export function Autopilot({
  on,
  thinking,
  yourTurn,
  finished,
  guidance,
  model,
  onToggle,
  onGuidance,
  onSetModel,
  prompts,
}: AutopilotProps) {
  const [draft, setDraft] = useState(guidance);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // Adopt server-sent guidance unless the user is mid-edit.
  useEffect(() => {
    if (!dirty.current) setDraft(guidance);
  }, [guidance]);

  const editGuidance = (text: string) => {
    setDraft(text);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      onGuidance(text);
    }, 450);
  };

  let statusText: string;
  let statusColor: string;
  if (!on) {
    statusText = "Off — you place workers manually.";
    statusColor = C.muted;
  } else if (thinking) {
    statusText = "● Thinking — querying the model for this move…";
    statusColor = C.ember;
  } else if (finished) {
    statusText = "Game over.";
    statusColor = C.muted;
  } else if (yourTurn) {
    statusText = "Active — your move is up; deciding…";
    statusColor = C.cyan;
  } else {
    statusText = "Active — waiting for your turn.";
    statusColor = C.live;
  }

  const recent = [...prompts].slice(-12).reverse();

  return (
    <div
      style={{
        flex: "none",
        background: "linear-gradient(180deg, #1a1d1a, #12140f)",
        border: `1px solid ${on ? "#6a5524" : C.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 16, letterSpacing: "0.06em", textTransform: "uppercase", color: C.ink }}>
          Autopilot
        </span>
        <select
          value={model}
          onChange={(e) => onSetModel(e.target.value)}
          aria-label="autopilot model"
          title="Bedrock model that drives this seat"
          style={{
            fontFamily: F.mono,
            fontSize: 9.5,
            letterSpacing: "0.04em",
            color: C.inkSoft,
            background: C.field,
            border: `1px solid ${C.border}`,
            borderRadius: 999,
            padding: "2px 7px",
            cursor: "pointer",
          }}
        >
          {BEDROCK_MODELS.map((m) => (
            <option key={m.id} value={m.id} style={{ fontFamily: F.mono, background: C.field, color: C.ink }}>
              {m.label}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          onClick={onToggle}
          aria-label="toggle autopilot"
          style={{
            width: 42,
            height: 23,
            borderRadius: 999,
            border: `1px solid ${on ? C.ember : "#2c3548"}`,
            background: on ? "rgba(255,160,21,0.22)" : C.field,
            position: "relative",
            cursor: "pointer",
            padding: 0,
            flex: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: on ? 21 : 2,
              width: 17,
              height: 17,
              borderRadius: "50%",
              background: on ? C.ember : C.muted,
              boxShadow: on ? "0 0 9px rgba(255,160,21,0.7)" : "none",
              transition: "left .15s, background .15s",
            }}
          />
        </button>
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>
        Guidance — steers every decision
      </div>
      <textarea
        value={draft}
        onChange={(e) => editGuidance(e.target.value)}
        placeholder="e.g. “Grow the family early, keep two fields sown, and trade spare animals to the blue farm.”"
        rows={3}
        style={{
          width: "100%",
          resize: "none",
          background: C.field,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          color: C.ink,
          fontFamily: F.body,
          fontSize: 12,
          lineHeight: 1.45,
        }}
      />
      <div style={{ fontSize: 11.5, color: statusColor, fontWeight: 500 }}>{statusText}</div>
      {recent.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>
            What the model saw &amp; decided
          </div>
          {recent.map((p, i) => (
            <details key={`${p.round}-${p.phase}-${i}`} style={{ background: C.field, border: `1px solid #1c2230`, borderRadius: 7, padding: "6px 9px" }}>
              <summary style={{ cursor: "pointer", fontSize: 11.5, color: C.inkSoft, lineHeight: 1.4 }}>
                <span style={{ fontFamily: F.mono, color: C.cyan }}>R{p.round}</span> · {p.phase} decision
              </summary>
              <pre
                style={{
                  margin: "6px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: F.mono,
                  fontSize: 9.5,
                  lineHeight: 1.5,
                  color: "#9aa5b1",
                  maxHeight: 240,
                  overflow: "auto",
                }}
              >
                {p.content}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
