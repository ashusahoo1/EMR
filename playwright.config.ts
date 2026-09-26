/**
 * End-to-end tests (browser-driven).
 *
 * WHY THIS EXISTS despite §5.10 ruling out E2E. That decision was made when
 * the plan expected the L2 in-process tests to cover the whole path -- and
 * they do cover the API's behaviour. What they cannot see is the BROWSER's
 * behaviour: hydration, React Query caching, form focus, navigation guards,
 * and the exact sequence of requests the client sends. Manual testing found
 * three real bugs in precisely those gaps (verification not persisted,
 * status stuck on Waiting, search results misread), and every one of them
 * had a green L2 suite behind it. A test that drives the API directly
 * asserts a sequence the application never performs.
 *
 * So this layer is narrow on purpose: the flows a doctor actually clicks
 * through, in a real Chromium, against real servers. It is not a component
 * test suite and it does not replace L1/L2.
 *
 * SERVERS ARE OWNED BY THE RUN. `webServer` starts the API and the web app on
 * ports nothing else uses (4100 / 3150) so the suite never depends on what
 * happens to be running, and never touches the developer's own ports. The
 * API runs with NODE_ENV=test, which routes model calls to the stub -- no
 * key, no network, deterministic output.
 */
import { defineConfig, devices } from '@playwright/test'

export const API_PORT = 4100
export const WEB_PORT = 3150
export const API_URL = `http://localhost:${API_PORT}`
export const WEB_URL = `http://localhost:${WEB_PORT}`

export default defineConfig({
  testDir: './e2e',
  // Tests share one database, so they must not interleave.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The phone-width pass (C10) as a real device profile, not a resized
    // desktop window -- touch, viewport and user-agent all match.
    //
    // A Chromium-based phone, deliberately. `iPhone SE` maps to WebKit,
    // which is a separate ~100MB download and was not installed; the first
    // run failed all four mobile tests on "Executable doesn't exist" rather
    // than on anything about the app. Galaxy S9+ is the narrowest Chromium
    // profile (320px), which is a STRICTER layout test than the 375px the
    // manual plan asked for.
    {
      name: 'mobile',
      use: { ...devices['Galaxy S9+'] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],

  webServer: [
    {
      command: `bun run src/index.ts`,
      cwd: './apps/api',
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        LLM_ENABLED: 'true',
        WEB_ORIGIN: WEB_URL,
        LOG_LEVEL: 'warn',
      },
    },
    {
      /**
       * A PRODUCTION build, not `next dev`, for two reasons.
       *
       * 1. Next 16 refuses to run two dev servers from one project directory,
       *    so `next dev` here would collide with (or kill) whatever dev server
       *    the developer has open. `next start` has no such lock.
       * 2. It is what deployment runs. A dev server's Turbopack compile on
       *    first request also adds seconds of latency to every cold route,
       *    which reads as flakiness in a test.
       *
       * The build is part of the command because NEXT_PUBLIC_API_URL is
       * inlined at BUILD time. Reusing a `.next` left behind by a dev server
       * would silently serve a bundle baked to a different API port.
       */
      command: `bun run build && bun run start --port ${WEB_PORT}`,
      cwd: './apps/web',
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NEXT_PUBLIC_API_URL: API_URL,
      },
    },
  ],
})
