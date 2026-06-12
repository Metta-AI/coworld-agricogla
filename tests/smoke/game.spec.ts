import { expect, test } from "@playwright/test";

test.describe("table view", () => {
  test("renders the action board, round track and four farms", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".round-pip")).toHaveCount(14);
    expect(await page.locator(".space").count()).toBeGreaterThanOrEqual(14);
    await expect(page.locator(".player-panel")).toHaveCount(4);
    await expect(page.locator(".farm")).toHaveCount(4);
    await expect(page.locator(".event-log li").first()).toBeVisible();
  });

  test("autopilot turns advance the game", async ({ page }) => {
    await page.goto("/");
    const currentRound = page.locator(".round-pip.current");
    await expect(currentRound).toHaveCount(1);
    const before = Number(await currentRound.textContent());
    await expect
      .poll(async () => Number(await currentRound.textContent()), { timeout: 45_000 })
      .toBeGreaterThan(before);
  });
});

test.describe("seat view", () => {
  test("shows the player's hand and compact opponents", async ({ page }) => {
    await page.goto("/player/2");
    await expect(page.locator(".hand-footer h3")).toHaveText("Your hand");
    expect(await page.locator(".hand-footer .game-card").count()).toBeGreaterThan(0);
    await expect(page.locator(".player-panel.me")).toHaveCount(1);
  });
});

test.describe("human control", () => {
  test("a human can take over a seat and place a worker", async ({ page }) => {
    await page.goto("/player/0");
    // Restart so the game cannot finish under us mid-test.
    await page.locator("button", { hasText: "new game" }).click();
    await page
      .locator(".player-panel.me select.controller-select")
      .selectOption("human");
    await expect(page.locator(".your-turn-banner")).toBeVisible({ timeout: 30_000 });
    // Pick the first open simple space (gold-outlined). Resource takes apply
    // immediately; parameterized spaces open a dialog — choose Forest-like
    // spaces by id to keep this deterministic.
    const simpleIds = [
      "forest",
      "clay_pit",
      "reed_bank",
      "fishing",
      "day_laborer",
      "grain_seeds",
    ];
    let clicked = false;
    for (const id of simpleIds) {
      const button = page.locator(`.space.clickable:has-text("${idToTitle(id)}")`);
      if ((await button.count()) > 0) {
        await button.first().click();
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);
    // Our worker disc appears on the chosen space and the banner goes away
    // while autopilots take their turns.
    await expect(page.locator(".space .worker").first()).toBeVisible({ timeout: 10_000 });
    // Hand the seat back to the autopilot so the server can finish the game.
    await page
      .locator(".player-panel.me select.controller-select")
      .selectOption("scripted");
  });
});

function idToTitle(id: string): string {
  switch (id) {
    case "forest":
      return "Forest";
    case "clay_pit":
      return "Clay Pit";
    case "reed_bank":
      return "Reed Bank";
    case "fishing":
      return "Fishing";
    case "day_laborer":
      return "Day Laborer";
    default:
      return "Grain Seeds";
  }
}
