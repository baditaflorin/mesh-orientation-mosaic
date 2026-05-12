import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

/**
 * Real DeviceOrientationEvent needs a physical phone, so we cover only the
 * mesh plumbing: each peer publishes its (off-state) reading and the other
 * peer should see it.
 */
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
