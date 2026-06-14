/** Distill a full game transcript (~1 MB of repeated state dumps) into a
 *  compact decision+reasoning+score digest (~30 KB) that fits in an analyst's
 *  context. Keeps what matters for prompt improvement: each decision's chosen
 *  action, the model's stated reasoning, rejections/fallbacks, table-talk, and
 *  the final score breakdown. */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { gameResultSchema } from "./types";

interface Decision {
  round: number;
  seat: number;
  label: string;
  phase: string;
  fellBack: boolean;
  action: string;
  args: string;
  reasoning: string;
  rejections: number;
}

/** Summarize the non-action arguments of a placement for the digest. */
function summarizeArgs(input: Record<string, unknown>): string {
  const keys = [
    "rooms", "stables", "spaces", "occupation", "improvement", "edges", "sow",
    "bake", "plow", "plowCard", "conversions",
  ];
  const parts: string[] = [];
  for (const k of keys) {
    if (input[k] === undefined) continue;
    const v = input[k];
    parts.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  return parts.length ? ` {${parts.join(", ")}}` : "";
}

function parseTranscript(content: string): { decisions: Decision[]; tableTalk: string[] } {
  const parts = content.split(/^===== (.+?) =====$/m);
  const decisions: Decision[] = [];
  let tableTalk: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]!;
    const body = parts[i + 1] ?? "";
    const talk = header.match(/^TABLE TALK/);
    if (talk) {
      tableTalk = body.trim().split("\n").filter(Boolean);
      continue;
    }
    const m = header.match(/^seat (\d+) \((.+?)\) \| round (\d+) \| (\w+)(.*)$/);
    if (!m) continue;
    const [, seat, label, round, phase, flag] = m;

    let action = "(none)";
    let args = "";
    let reasoning = "";
    const toolLine = body.match(/^tool input: (.+)$/m);
    if (toolLine) {
      try {
        const input = JSON.parse(toolLine[1]!) as Record<string, unknown>;
        action = typeof input.action === "string" ? input.action : phase === "feeding" ? "feed" : "?";
        args = summarizeArgs(input);
        const thoughts = input.thoughts ?? input.diary;
        if (typeof thoughts === "string") reasoning = thoughts;
      } catch {
        /* leave defaults */
      }
    }
    if (!reasoning) {
      const modelLine = body.match(/^model: (.+)$/m);
      if (modelLine) reasoning = modelLine[1]!;
    }
    decisions.push({
      round: Number(round),
      seat: Number(seat),
      label: label!,
      phase: phase!,
      fellBack: /FELL BACK/.test(flag ?? ""),
      action,
      args,
      reasoning: reasoning.replace(/\s+/g, " ").slice(0, 180),
      rejections: (body.match(/^rejected: /gm) ?? []).length,
    });
  }
  return { decisions, tableTalk };
}

export function condenseGame(transcriptPath: string, resultPath: string): string {
  const result = gameResultSchema.parse(JSON.parse(readFileSync(resultPath, "utf8")));
  const { decisions, tableTalk } = parseTranscript(readFileSync(transcriptPath, "utf8"));

  const lines: string[] = [];
  lines.push(`# Game ${result.gameId} (seed ${result.seed}, ${result.numPlayers}p, ${result.model})`);
  lines.push("");
  lines.push("## Final scores (seat: total — nonzero categories)");
  for (const s of [...result.seats].sort((a, b) => b.total - a.total)) {
    const cats = s.categories.filter((c) => c.points !== 0).map((c) => `${c.label}=${c.points}`).join(", ");
    lines.push(`- seat ${s.idx} **${s.label}**: ${s.total} — ${cats}`);
  }
  lines.push("");
  lines.push("## Decisions (round | seat/label | phase | action | reasoning)");
  for (const d of decisions) {
    const fb = d.fellBack ? " ⚠FELLBACK" : "";
    const rej = d.rejections ? ` (${d.rejections} rejected)` : "";
    lines.push(
      `- r${d.round} s${d.seat}/${d.label} ${d.phase}: ${d.action}${d.args}${fb}${rej}` +
        (d.reasoning ? ` — "${d.reasoning}"` : ""),
    );
  }
  if (tableTalk.length) {
    lines.push("");
    lines.push("## Table talk");
    for (const t of tableTalk) lines.push(`- ${t}`);
  }
  return lines.join("\n");
}

/** Condense every game in a run directory; returns the written digest paths. */
export function condenseRun(runDir: string): string[] {
  const results = readdirSync(runDir).filter((f) => f.endsWith(".result.json"));
  const paths: string[] = [];
  for (const rf of results) {
    const gameId = rf.replace(/\.result\.json$/, "");
    const transcript = join(runDir, `${gameId}.transcript.txt`);
    const digest = condenseGame(transcript, join(runDir, rf));
    const out = join(runDir, `${gameId}.digest.md`);
    writeFileSync(out, digest);
    paths.push(out);
  }
  return paths;
}

const isDirectRun =
  process.argv[1]?.endsWith("condense.ts") || process.argv[1]?.endsWith("condense.js");
if (isDirectRun) {
  const runDir = process.argv[2];
  if (!runDir) throw new Error("usage: tsx src/experiments/condense.ts <runDir>");
  const paths = condenseRun(runDir);
  for (const p of paths) console.log(p);
  console.log(`condensed ${paths.length} game(s) in ${dirname(paths[0] ?? runDir)}`);
}
