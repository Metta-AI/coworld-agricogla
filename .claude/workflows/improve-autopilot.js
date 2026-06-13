export const meta = {
  name: 'improve-autopilot',
  description:
    'Study Agricogla autopilot game transcripts, then propose & adversarially judge candidate prompt-block variants to A/B test against the baseline.',
  whenToUse:
    'After generating baseline (or candidate) game transcripts with src/experiments/ab-test.ts. Returns ranked weaknesses and ready-to-test candidate prompt variants. Does NOT run games (they exceed the per-agent Bash limit) — it consumes transcripts and emits candidates; the caller runs the A/B harness.',
  phases: [
    { title: 'Analyze', detail: 'one agent per game-facet reads transcripts for weaknesses' },
    { title: 'Synthesize', detail: 'dedup + rank weaknesses across facets' },
    { title: 'Propose', detail: 'draft one minimal candidate prompt variant per top weakness' },
    { title: 'Judge', detail: 'adversarially verify each candidate for rule-correctness & isolation' },
  ],
}

// ---- args -------------------------------------------------------------------
// {
//   transcriptPaths: string[]   // *.transcript.txt files to study (required)
//   rulesPath: string           // path to RULES.md (rules ground truth)
//   promptPath: string          // path to src/agents/llm/prompt.ts (current blocks)
//   renderPath: string          // path to src/agents/llm/render.ts (state rendering)
//   maxCandidates?: number      // cap on candidates to propose (default 4)
//   parentVariant?: string      // parent to inherit from (default "baseline")
// }
let a = args ?? {}
if (typeof a === 'string') {
  try { a = JSON.parse(a) } catch { a = {} }
}
const transcriptPaths = a.transcriptPaths ?? []
log(`improve-autopilot: ${transcriptPaths.length} transcript(s) received`)
const rulesPath = a.rulesPath ?? 'RULES.md'
const promptPath = a.promptPath ?? 'src/agents/llm/prompt.ts'
const renderPath = a.renderPath ?? 'src/agents/llm/render.ts'
const maxCandidates = a.maxCandidates ?? 4
const parentVariant = a.parentVariant ?? 'baseline'

if (transcriptPaths.length === 0) {
  log('No transcriptPaths provided; nothing to analyze.')
  return { error: 'no transcripts', candidates: [] }
}

const transcriptList = transcriptPaths.map((p) => `- ${p}`).join('\n')
const context = `
Ground truth you MUST read before judging anything:
- Rules spec: ${rulesPath}
- Current policy prompt blocks (intro/rules/strategy/output): ${promptPath}
- Current state rendering (how the board is described to the model): ${renderPath}

Game digests to study (each is one compact game: final score breakdown per seat, then every decision as "rN sSEAT/label phase: action {args} — reasoning"; "⚠FELLBACK" marks a decision the LLM failed to make legally; a final "Table talk" section if chat was on):
${transcriptList}

Background: Agricogla is a worker-placement farming game. The autopilot is an LLM that, each turn, gets the state + legal options and must call submit_placement / submit_feeding. We are optimizing its policy prompt. The prompt is split into independently-editable blocks: "intro", "rules", "strategy", "output", plus an optional per-seat free-text "guidance" directive. Scoring rewards BALANCE across categories (fields, pastures, grain, vegetables, sheep, boar, cattle, family size, rooms) and PUNISHES empty categories (-1 each) and unused farm spaces (-1 each); begging cards from underfeeding are -3 each.

The autopilot also has two optional capabilities a variant can switch on:
- memory: a private diary the model writes via a "diary" tool field and reads back each turn (good for multi-turn plan coherence).
- chat: table-talk; the model posts via a "say" field and sees other cogs' messages (good for racing contested spaces / negotiation).
Transcripts include a "TABLE TALK" section and "YOUR DIARY" blocks when these were on. If a weakness is about incoherent multi-turn plans or ignoring opponents, consider proposing a candidate that enables a capability (and a strategy nudge to use it) instead of just rewording a block.
`

// ---- Phase 1: Analyze (one lens per game-facet) -----------------------------
phase('Analyze')

const FACETS = [
  {
    key: 'feeding-starvation',
    focus:
      'Feeding & starvation: did players take begging cards (-3 each)? Did they underfeed, or over-hoard food they could have spent? Did they kill breeding pairs unnecessarily at feeding? Was food planning reactive vs proactive across the harvest schedule (rounds 4,7,9,11,13,14)?',
  },
  {
    key: 'family-growth',
    focus:
      'Family growth timing: each new member = ~3 pts + an extra action every remaining round, so early growth compounds. Did players build rooms and grow family EARLY, or stay at 2 members too long? Did they waste the urgent-family space, or grow into a food deficit?',
  },
  {
    key: 'improvements-occupations',
    focus:
      'Improvements & occupations: did players buy useful majors (ovens/fireplace for cooking, wells, points) and play strong occupations/minors early enough to compound? Did they leave powerful cards unplayed in hand? Did they misvalue cost vs payoff?',
  },
  {
    key: 'animals-fences-fields',
    focus:
      'Animals, fences, fields: did players build pastures and keep animals (sheep/boar/cattle) for breeding + points, or leave those categories at -1? Did they plow/sow fields for grain/veg points and food? Did they leave many unused farm spaces (-1 each)?',
  },
  {
    key: 'action-efficiency',
    focus:
      'Action-selection efficiency: did players waste placements on low-value piles, repeatedly grab the same resource, or take actions that did not advance score/food? Did they fail to use accumulating piles when fat? Were there decisions that look clearly dominated by an available alternative?',
  },
  {
    key: 'illegal-and-confusion',
    focus:
      'Illegal moves, retries, and FELL BACK events: where did the model propose illegal moves or fall back to scripted? What rule/format confusion caused it (misread legality, bad args, hallucinated options)? Which prompt block (rules clarity, output format, or state rendering) would prevent it?',
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    facet: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          weakness: { type: 'string', description: 'specific, behavior-level weakness observed' },
          evidence: { type: 'string', description: 'concrete quote/round/seat from a transcript' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          blockToFix: {
            type: 'string',
            enum: ['rules', 'strategy', 'output', 'guidance', 'state-rendering'],
            description: 'which prompt surface most likely fixes this',
          },
          fixIdea: { type: 'string', description: 'concrete prompt change that would address it' },
        },
        required: ['weakness', 'evidence', 'impact', 'blockToFix', 'fixIdea'],
      },
    },
  },
  required: ['facet', 'findings'],
}

const analyses = await parallel(
  FACETS.map((f) => () =>
    agent(
      `${context}\n\nYou are a focused game analyst. LENS: ${f.key}.\n${f.focus}\n\n` +
        `Read RULES.md and the current prompt first, then read the transcripts. Find the MOST IMPACTFUL, RECURRING weaknesses in how the autopilot plays through THIS lens — patterns across games, not one-off noise. For each, give a concrete transcript citation (which file/round/seat), the impact, the single prompt surface most likely to fix it, and a concrete fix idea. Be specific and grounded; do not invent rules. Return 2-5 findings.`,
      { label: `analyze:${f.key}`, phase: 'Analyze', schema: FINDINGS_SCHEMA },
    ),
  ),
)

const allFindings = analyses
  .filter(Boolean)
  .flatMap((r) => (r.findings ?? []).map((f) => ({ ...f, facet: r.facet })))

log(`Collected ${allFindings.length} findings across ${FACETS.length} facets.`)

// ---- Phase 2: Synthesize (dedup + rank) -------------------------------------
phase('Synthesize')

const RANK_SCHEMA = {
  type: 'object',
  properties: {
    weaknesses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          blockToFix: {
            type: 'string',
            enum: ['rules', 'strategy', 'output', 'guidance', 'state-rendering'],
          },
          expectedImpact: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string', description: 'why fixing this should raise score' },
        },
        required: ['title', 'summary', 'blockToFix', 'expectedImpact', 'rationale'],
      },
    },
  },
  required: ['weaknesses'],
}

const ranked = await agent(
  `${context}\n\nHere are findings from ${FACETS.length} analysts (JSON):\n${JSON.stringify(allFindings, null, 2)}\n\n` +
    `Deduplicate overlapping findings and rank the DISTINCT, highest-leverage weaknesses to fix in the autopilot prompt. ` +
    `Prefer weaknesses that (a) recur across games, (b) cost real points, and (c) are fixable with a small, isolated prompt change. ` +
    `Return the top ${maxCandidates} weaknesses, each mapped to the single prompt surface that should change.`,
  { label: 'synthesize', phase: 'Synthesize', schema: RANK_SCHEMA },
)

const weaknesses = (ranked?.weaknesses ?? []).slice(0, maxCandidates)
log(`Ranked ${weaknesses.length} weaknesses to target.`)

// ---- Phase 3 + 4: Propose then adversarially Judge (pipelined) --------------
phase('Propose')

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'kebab-case variant name, e.g. cand-grow-family-early' },
    notes: { type: 'string', description: 'one line: what this variant changes and why' },
    targetsWeakness: { type: 'string' },
    blockChanged: { type: 'string', enum: ['rules', 'strategy', 'output', 'guidance'] },
    blocks: {
      type: 'object',
      description:
        'FULL replacement text for ONLY the block(s) you change (intro/rules/strategy/output). Omit blocks you keep from the parent. Keep changes minimal and isolated.',
      properties: {
        intro: { type: 'string' },
        rules: { type: 'string' },
        strategy: { type: 'string' },
        output: { type: 'string' },
      },
    },
    guidance: { type: 'string', description: 'per-seat directive, or "" if unused' },
    capabilities: {
      type: 'object',
      description: 'optionally enable memory/chat for this candidate (omit to inherit baseline = both off)',
      properties: { memory: { type: 'boolean' }, chat: { type: 'boolean' } },
    },
  },
  required: ['name', 'notes', 'targetsWeakness', 'blockChanged', 'blocks', 'guidance'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    accept: { type: 'boolean' },
    ruleCorrect: { type: 'boolean', description: 'no invented/incorrect rules vs RULES.md' },
    isolated: { type: 'boolean', description: 'change is minimal and confined to the intended block' },
    reason: { type: 'string' },
    repairedBlocks: {
      type: 'object',
      description: 'if a small fix makes it acceptable, the corrected block text; else omit',
      properties: {
        intro: { type: 'string' },
        rules: { type: 'string' },
        strategy: { type: 'string' },
        output: { type: 'string' },
      },
    },
    repairedGuidance: { type: 'string' },
  },
  required: ['accept', 'ruleCorrect', 'isolated', 'reason'],
}

const results = await pipeline(
  weaknesses,
  // Stage 1: propose a minimal candidate variant for this weakness.
  (w, _orig, i) =>
    agent(
      `${context}\n\nPropose ONE candidate prompt variant (parent: "${parentVariant}") that fixes this weakness:\n` +
        `${JSON.stringify(w, null, 2)}\n\n` +
        `Rules for a good candidate:\n` +
        `- Change ONLY the block(s) that address this weakness (usually one of strategy/rules/guidance). Provide FULL replacement text for changed blocks; omit unchanged blocks.\n` +
        `- Keep it minimal and isolated so the A/B test attributes any score change to THIS idea.\n` +
        `- Stay strictly faithful to RULES.md — do not invent mechanics, costs, or numbers. Read RULES.md and ${promptPath} first.\n` +
        `- Write tight, declarative guidance an LLM can act on; avoid vague platitudes.\n` +
        `- Name it kebab-case starting "cand-", index ${i}.`,
      { label: `propose:${w.title?.slice(0, 30)}`, phase: 'Propose', schema: CANDIDATE_SCHEMA },
    ),
  // Stage 2: adversarial judge — rule-correctness + isolation + likely benefit.
  (cand, w) => {
    if (!cand) return null
    return agent(
      `${context}\n\nAdversarially review this candidate prompt variant. Be skeptical.\n` +
        `Weakness it targets: ${JSON.stringify(w)}\n` +
        `Candidate: ${JSON.stringify(cand, null, 2)}\n\n` +
        `Check, reading RULES.md as ground truth:\n` +
        `1. ruleCorrect: does every factual claim match RULES.md? Reject invented costs/mechanics/numbers.\n` +
        `2. isolated: is the change minimal and confined to the block(s) it should touch? Reject sprawling rewrites.\n` +
        `3. likely-helpful: would this plausibly raise score for the targeted weakness without obvious new failure modes?\n` +
        `If a SMALL edit fixes it, set accept=true and return repairedBlocks/repairedGuidance with corrected text. Otherwise accept=false with a crisp reason.`,
      { label: `judge:${cand.name}`, phase: 'Judge', schema: VERDICT_SCHEMA },
    ).then((v) => ({ candidate: cand, weakness: w, verdict: v }))
  },
)

// ---- Assemble accepted candidates -------------------------------------------
const accepted = results
  .filter(Boolean)
  .filter((r) => r.verdict && r.verdict.accept)
  .map((r) => {
    const v = r.verdict
    // Apply judge repairs if provided.
    const blocks = { ...(r.candidate.blocks ?? {}), ...(v.repairedBlocks ?? {}) }
    const guidance = v.repairedGuidance ?? r.candidate.guidance ?? ''
    return {
      name: r.candidate.name,
      parent: parentVariant,
      notes: r.candidate.notes,
      targetsWeakness: r.candidate.targetsWeakness,
      blockChanged: r.candidate.blockChanged,
      blocks,
      guidance,
      ...(r.candidate.capabilities ? { capabilities: r.candidate.capabilities } : {}),
      judge: { ruleCorrect: v.ruleCorrect, isolated: v.isolated, reason: v.reason },
    }
  })

const rejected = results
  .filter(Boolean)
  .filter((r) => !(r.verdict && r.verdict.accept))
  .map((r) => ({ name: r.candidate?.name, reason: r.verdict?.reason }))

log(`Accepted ${accepted.length} candidate(s); rejected ${rejected.length}.`)

return {
  weaknesses,
  accepted,
  rejected,
  // Ready-to-run A/B commands the caller can execute (in the background).
  abCommands: accepted.map(
    (c) =>
      `AWS_PROFILE=softmax AWS_REGION=us-west-2 npx tsx src/experiments/ab-test.ts --candidate ${c.name} --baseline ${parentVariant} --model us.anthropic.claude-sonnet-4-6 --seeds 11,22,33,44`,
  ),
  writeInstructions:
    'Write each accepted candidate to experiments/variants/<name>.json as {name,parent,notes,blocks,guidance,capabilities?}, then run its abCommand in the background.',
}
