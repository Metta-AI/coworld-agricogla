import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplayViewer } from "./Replay";
import { ReplayPayload } from "../shared/coworld-protocol";

/** Render the replay viewer's initial state (no DOM needed — useState defaults
 *  apply under server rendering) and assert it opens on the feed, with chat. */
const payload: ReplayPayload = {
  game: "agricogla",
  seed: 5,
  numPlayers: 2,
  playerNames: ["Anna", "Bo"],
  actions: [],
  chat: [
    { seq: 0, round: 1, from: 0, to: null, text: "Leave me the forest" },
    { seq: 1, round: 1, from: 1, to: 0, text: "Only if you spare the clay" },
  ],
  results: { scores: [10, 20], winner: 1, rounds: 14 },
};

describe("replay viewer", () => {
  it("defaults to the feed view and shows recorded table-talk", () => {
    const html = renderToStaticMarkup(<ReplayViewer payload={payload} />);
    // Feed view is the default (its heading, not the table view's columns).
    expect(html).toContain("Negotiation feed");
    // Recorded chat from round 1 is revealed at the start.
    expect(html).toContain("Leave me the forest");
    expect(html).toContain("Only if you spare the clay");
    // Both view tabs are present so the user can switch to the table.
    expect(html).toContain("feed");
    expect(html).toContain("table");
  });

  it("renders an empty feed gracefully for replays without recorded chat", () => {
    const html = renderToStaticMarkup(<ReplayViewer payload={{ ...payload, chat: undefined }} />);
    expect(html).toContain("Negotiation feed");
    expect(html).toContain("No table talk yet.");
  });
});
