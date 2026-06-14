import { expect, test, type Page } from "@playwright/test";

/** Read the live round number from the header chip. */
async function currentRound(page: Page): Promise<number> {
  const value = await page.getByTestId("round-indicator").getAttribute("data-round");
  return Number(value);
}

/** Start a fresh game and wait for it to be live again. When a game has ended
 *  the final-scoring overlay covers the footer button, so use its "Play again"
 *  button in that case. */
async function resetGame(page: Page): Promise<void> {
  await expect(page.getByTestId("round-indicator")).toBeVisible();
  const playAgain = page.getByRole("button", { name: "Play again" });
  if (await playAgain.isVisible().catch(() => false)) {
    await playAgain.click();
  } else {
    await page.getByTestId("new-game").click();
  }
  // The reset is delivered over the websocket; wait for the fresh game to land.
  await expect.poll(() => currentRound(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
}

test.describe("table view", () => {
  test("renders the action board and four farms", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("action-board")).toBeVisible();
    expect(await page.getByTestId("action-space").count()).toBeGreaterThanOrEqual(14);
    await expect(page.getByTestId("mini-farm")).toHaveCount(4);
    await expect(page.getByTestId("round-indicator")).toBeVisible();
  });

  test("scripted turns advance the game", async ({ page }) => {
    await page.goto("/");
    await resetGame(page);
    const before = await currentRound(page);
    await expect
      .poll(() => currentRound(page), { timeout: 45_000 })
      .toBeGreaterThan(before);
  });
});

test.describe("seat view", () => {
  test("shows the player's hand", async ({ page }) => {
    await page.goto("/player/2");
    // Fresh deal so the hand is full rather than spent late-game.
    await resetGame(page);
    const hand = page.getByTestId("your-hand");
    await expect(hand).toBeVisible();
    await expect(hand.getByRole("heading", { name: "Your hand" })).toBeVisible();
    expect(await hand.locator(".game-card").count()).toBeGreaterThan(0);
  });
});

test.describe("human control", () => {
  test("a human can claim a seat and place a worker", async ({ page }) => {
    await page.goto("/player/0");
    // Fresh game so it cannot finish under us mid-test.
    await resetGame(page);

    // Flip autopilot off → seat 0 (Anna) is now driven by the human.
    const toggle = page.getByTestId("autopilot-toggle");
    await expect(toggle).toHaveAttribute("data-on", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-on", "false");

    // The game halts on Anna's turn and the open spaces become clickable.
    await expect(page.getByTestId("turn-chip")).toHaveAttribute("data-myturn", "true", {
      timeout: 30_000,
    });

    // Place a worker on the first open "simple" resource space — these take
    // effect immediately, unlike build/sow/improvement spaces which open a
    // parameter dialog.
    const simpleIds = [
      "forest",
      "clay_pit",
      "reed_bank",
      "fishing",
      "day_laborer",
      "grain_seeds",
      "copse",
      "grove",
      "hollow",
    ];
    let placedId: string | null = null;
    for (const id of simpleIds) {
      const open = page.locator(`[data-space-id="${id}"][data-clickable="true"]`);
      if ((await open.count()) > 0) {
        await open.first().click();
        placedId = id;
        break;
      }
    }
    expect(placedId).not.toBeNull();

    // Anna's worker now occupies the chosen space. Seat 0 still has a second
    // worker to place, so the game stays halted on Anna and the space cannot
    // clear under us before we assert.
    await expect(page.locator(`[data-space-id="${placedId}"]`)).toHaveAttribute(
      "data-occupant",
      "Anna",
    );

    // Hand the seat back to autopilot (scripted brain) so the shared server keeps
    // advancing. The model dropdown is never disabled, unlike the toggle, which
    // is disabled while off when no Bedrock models were discovered.
    await page.getByLabel("autopilot model").selectOption("scripted");
  });
});
