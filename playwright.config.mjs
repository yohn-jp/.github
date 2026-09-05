import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  testMatch: "portal-browser.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixels: 24
    }
  },
  reporter: "line",
  snapshotPathTemplate: "{testDir}/fixtures/portal-visual/{arg}{ext}",
  use: {
    browserName: "chromium",
    colorScheme: "light",
    locale: "en-US",
    reducedMotion: "reduce",
    screenshot: "only-on-failure"
  }
});
