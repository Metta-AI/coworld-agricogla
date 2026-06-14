import { describe, expect, it } from "vitest";
import { discoverAvailableModels } from "./model-discovery";
import { BedrockModel } from "../../shared/protocol";

const CANDIDATES: BedrockModel[] = [
  { id: "model-a", label: "A" },
  { id: "model-b", label: "B" },
  { id: "model-c", label: "C" },
];

describe("discoverAvailableModels", () => {
  it("keeps only candidates whose probe succeeds, preserving order", async () => {
    const reachable = new Set(["model-a", "model-c"]);
    const got = await discoverAvailableModels({
      candidates: CANDIDATES,
      probe: async (id) => reachable.has(id),
    });
    expect(got).toEqual([
      { id: "model-a", label: "A" },
      { id: "model-c", label: "C" },
    ]);
  });

  it("returns an empty list when no model is reachable (e.g. no credentials)", async () => {
    const got = await discoverAvailableModels({
      candidates: CANDIDATES,
      probe: async () => false,
    });
    expect(got).toEqual([]);
  });

  it("treats a probe that throws as unavailable rather than failing discovery", async () => {
    const got = await discoverAvailableModels({
      candidates: CANDIDATES,
      probe: async (id) => {
        if (id === "model-b") throw new Error("AccessDeniedException");
        return true;
      },
    });
    expect(got.map((m) => m.id)).toEqual(["model-a", "model-c"]);
  });
});
