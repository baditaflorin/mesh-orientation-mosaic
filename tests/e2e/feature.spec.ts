import { expect, test, type Page } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("arm button visible; help text describes the mechanic", async ({ page, baseURL }) => {
  await page.goto(baseURL ?? "");
  await expect(page.getByRole("button", { name: /arm orientation/i })).toBeVisible();
  await expect(page.getByText(/target compass heading/i)).toBeVisible();
});

test("each peer publishes its off-state reading; the other peer sees it", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder(/your name/i).fill("alice");
    await b.getByPlaceholder(/your name/i).fill("bob");
    // Off-state readings publish on disarm/idle mount. Each peer should
    // appear in the other peer's "on target: x/y" list once readings flow.
    await expect(b.locator(".om-list").getByText("alice")).toBeVisible();
    await expect(a.locator(".om-list").getByText("bob")).toBeVisible();
  } finally {
    await cleanup();
  }
});

// Read the "target yaw: X°" the app assigned this peer (derived from its peerId).
async function targetYawOf(page: Page): Promise<number> {
  const text = await page.locator(".om-readout").innerText();
  const m = text.match(/target yaw:\s*(\d+)/i);
  if (!m) throw new Error(`could not read target yaw from readout: ${JSON.stringify(text)}`);
  return Number(m[1]);
}

// Dispatch a synthetic DeviceOrientationEvent. The publish effect is rate
// limited to 1 per 300 ms, so fire twice ~360 ms apart to guarantee a write
// lands after the tilt state updates.
async function aimAt(page: Page, alpha: number, beta = 0): Promise<void> {
  const fire = () =>
    page.evaluate(
      ({ alpha, beta }) => {
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientation", {
            alpha,
            beta,
            gamma: 0,
          } as DeviceOrientationEventInit),
        );
      },
      { alpha, beta },
    );
  await fire();
  await page.waitForTimeout(360);
  await fire();
  await page.waitForTimeout(120);
}

// Load-bearing cross-peer assertion. Two peers each ARM and tilt their (virtual)
// phone to their OWN assigned target yaw. The room's "all aligned" solve state
// lives in a shared Y.Map("peers") and is rendered as data-all-aligned on BOTH
// peers' .om-screen. The test proves:
//   1. when BOTH peers reach their target angle, BOTH screens flip to "1" — the
//      solve state crossed the mesh (peer B's flag depends on peer A's match);
//   2. when one peer tilts AWAY, BOTH screens flip back to "0" — detection is
//      live, computed from each peer's shared match, not a stale local copy.
// A local-only solve state (or a missing peers.set) makes assertion (1) fail.
test("both peers reaching their target angle flips the shared 'aligned' state on both screens", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder(/your name/i).fill("alice");
    await b.getByPlaceholder(/your name/i).fill("bob");

    // Arm both peers' orientation sensors.
    await a.getByRole("button", { name: /arm orientation/i }).click();
    await b.getByRole("button", { name: /arm orientation/i }).click();

    // Each peer aims its phone at the exact yaw the app assigned it (pitch 0 =
    // flat). yawScore = 1 - |Δ|/30, so Δ=0 → match 1.0 ≥ 0.85 threshold.
    const aTarget = await targetYawOf(a);
    const bTarget = await targetYawOf(b);
    await aimAt(a, aTarget, 0);
    await aimAt(b, bTarget, 0);

    // Sanity: each peer is locally on-target (match 100%).
    await expect(a.locator(".om-readout")).toContainText("match: 100%");
    await expect(b.locator(".om-readout")).toContainText("match: 100%");

    // The SHARED solve state must show on BOTH screens — proof the match score
    // crossed the mesh. Peer A's screen turning "1" requires peer B's armed
    // match (and vice versa) to have synced through Y.Map("peers").
    await expect(a.locator(".om-screen")).toHaveAttribute("data-all-aligned", "1");
    await expect(b.locator(".om-screen")).toHaveAttribute("data-all-aligned", "1");
    await expect(a.locator(".om-group")).toContainText("on target: 2/2");
    await expect(b.locator(".om-group")).toContainText("on target: 2/2");

    // Now drive peer A 90° AWAY from its target. Its match collapses well below
    // the 0.85 threshold, so the room is no longer fully aligned — and peer B,
    // who did not move, must ALSO see "0" because it reads A's LIVE shared match.
    await aimAt(a, (aTarget + 90) % 360, 0);
    await expect(a.locator(".om-screen")).toHaveAttribute("data-all-aligned", "0");
    await expect(b.locator(".om-screen")).toHaveAttribute("data-all-aligned", "0");
    await expect(b.locator(".om-group")).toContainText("on target: 1/2");
  } finally {
    await cleanup();
  }
});
