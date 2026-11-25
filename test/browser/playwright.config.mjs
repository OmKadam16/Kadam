// Browser tests (frontend plan F2 exit): real rendering at 360/768/1280/1600px
// with approved screenshot baselines, plus axe checks that need a real
// renderer (color contrast). Dev-only (D-15); run with `npm run test:browser`.
//
// The installed Google Chrome is used, so no browser download is needed. On a
// machine without Chrome, run `npx playwright install chrome` first.
// Baselines are per platform (fonts differ); refresh them after an approved
// visual change with `npm run test:browser -- --update-snapshots`.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  fullyParallel: true,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
  use: {
    channel: "chrome",
    headless: true,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  },
});
