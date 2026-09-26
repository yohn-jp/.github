import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { buildDashboard } from "../scripts/build-dashboard.mjs";
import {
  dashboardConfigFromRegistry,
  loadPortalRegistry
} from "../scripts/portal-registry.mjs";

const FIXED_NOW = new Date("2026-08-23T00:00:00.000Z");

let siteDirectory;
let server;
let baseUrl;
let expectedRepositoryCount;
let expectedIssueCount;
let engineeringFixtureRules;
const ENGINEERING_REVISION = "a".repeat(40);

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function issue(repository, number, title) {
  return {
    id: `${repository}-${number}`,
    repository_url: `https://api.github.com/repos/yohn-jp/${repository}`,
    number,
    title,
    html_url: `https://github.com/yohn-jp/${repository}/issues/${number}`,
    state: "open",
    state_reason: null,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-22T00:00:00Z",
    labels: [{ name: "portal", color: "d9ff63" }],
    assignees: [],
    issue_dependencies_summary:
      number === 1
        ? { blocked_by: 0, blocking: 1 }
        : { blocked_by: 1, blocking: 0 }
  };
}

function repositoryIssues(repository) {
  return [
    issue(
      repository,
      1,
      "Protect the portal layout when summaries and actions vary in length"
    ),
    issue(
      repository,
      2,
      "Verify the browser-level geometry contract across localized surfaces"
    )
  ];
}

async function fixtureFetch(url) {
  const parsed = new URL(String(url));
  const match = parsed.pathname.match(/^\/repos\/yohn-jp\/([^/]+)(.*)$/);
  if (!match) throw new Error(`Unexpected fixture URL: ${url}`);

  const repository = decodeURIComponent(match[1]);
  const suffix = match[2];
  const issues = repositoryIssues(repository);
  if (suffix === "") {
    return jsonResponse({
      id: repository,
      name: repository,
      full_name: `yohn-jp/${repository}`,
      html_url: `https://github.com/yohn-jp/${repository}`,
      visibility: "public"
    });
  }
  if (suffix === "/issues") return jsonResponse(issues);
  if (suffix === "/contents/package.json") {
    return jsonResponse({
      type: "file",
      encoding: "base64",
      content: Buffer.from(JSON.stringify({ version: "0.1.0" })).toString(
        "base64"
      ),
      html_url: `https://github.com/yohn-jp/${repository}/blob/main/package.json`
    });
  }
  const rules = engineeringFixtureRules?.get(repository);
  if (rules && suffix === "/git/ref/heads/main") {
    return jsonResponse({ object: { sha: ENGINEERING_REVISION } });
  }
  if (rules && suffix === `/git/trees/${ENGINEERING_REVISION}`) {
    return jsonResponse({
      truncated: false,
      tree: [
        {
          type: "blob",
          path: `${rules.sourceIncludePaths[0]}/sample.mjs`,
          sha: "b".repeat(40)
        },
        {
          type: "blob",
          path: `${rules.testIncludePaths[0]}/sample.test.mjs`,
          sha: "c".repeat(40)
        },
        ...(repository === "nawabari"
          ? [
              {
                type: "blob",
                path: `${rules.testIncludePaths[0]}/sample-extra.test.mjs`,
                sha: "d".repeat(40)
              }
            ]
          : [])
      ]
    });
  }
  if (rules && suffix.startsWith("/git/blobs/")) {
    if (repository === "nawabari" && suffix.endsWith("c".repeat(40))) {
      return new Response("{}", { status: 503 });
    }
    return jsonResponse({
      encoding: "base64",
      content: Buffer.from("export const measured = true;\n").toString("base64")
    });
  }
  if (rules && suffix === "/actions/runs") {
    if (repository === "suzukuri") return new Response("{}", { status: 503 });
    if (repository === "cli-canon") return jsonResponse({ workflow_runs: [] });
    const stale = repository === "nawabari";
    return jsonResponse({
      workflow_runs: [
        {
          id: 42,
          name: "CI",
          head_branch: "main",
          head_sha: ENGINEERING_REVISION,
          status: "completed",
          conclusion: repository === "gh-inari" ? "cancelled" : "success",
          created_at: stale ? "2026-06-01T00:00:00Z" : "2026-08-22T00:00:00Z",
          run_started_at: stale
            ? "2026-06-01T00:00:00Z"
            : "2026-08-22T00:00:00Z",
          completed_at: stale ? "2026-06-01T00:00:03Z" : "2026-08-22T00:00:03Z",
          html_url: `https://github.com/yohn-jp/${repository}/actions/runs/42`
        }
      ]
    });
  }

  const dependency = suffix.match(
    /^\/issues\/(\d+)\/dependencies\/(blocked_by|blocking)$/
  );
  if (dependency) {
    const number = Number(dependency[1]);
    if (number === 1 && dependency[2] === "blocking") {
      return jsonResponse([issues[1]]);
    }
    if (number === 2 && dependency[2] === "blocked_by") {
      return jsonResponse([issues[0]]);
    }
    return jsonResponse([]);
  }

  throw new Error(`Unexpected fixture path: ${parsed.pathname}`);
}

async function buildFixtureSite() {
  siteDirectory = await mkdtemp(join(tmpdir(), "portal-browser-"));
  const registry = await loadPortalRegistry("portal/registry.json");
  const rawRegistry = JSON.parse(
    await readFile("portal/registry.json", "utf8")
  );
  engineeringFixtureRules = new Map(
    registry.products.map((product) => [
      new URL(product.repository).pathname.split("/").at(-1),
      rawRegistry.engineering.products[product.id]
    ])
  );
  expectedRepositoryCount =
    dashboardConfigFromRegistry(registry).repositories.length;
  expectedIssueCount = expectedRepositoryCount * 2;
  await buildDashboard({
    outputDirectory: siteDirectory,
    fetchImpl: fixtureFetch,
    token: "",
    now: () => FIXED_NOW,
    governancePreflight: async () => ({ status: "healthy" }),
    governanceImpl: async () => ({
      status: "valid",
      valid: true,
      classification: "feature",
      violations: [],
      dependencies: { blockedBy: [], blocks: [] }
    })
  });
}

function contentType(path) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".webp": "image/webp"
    }[extname(path)] ?? "application/octet-stream"
  );
}

async function startStaticServer(root) {
  const resolvedRoot = resolve(root);
  server = createServer(async (request, response) => {
    try {
      const requestPath = new URL(request.url ?? "/", "http://localhost")
        .pathname;
      const relativePath =
        requestPath === "/"
          ? "index.html"
          : `${requestPath.slice(1)}${requestPath.endsWith("/") ? "index.html" : ""}`;
      const filePath = resolve(resolvedRoot, relativePath);
      const relativeFilePath = relative(resolvedRoot, filePath);
      if (
        relativeFilePath.startsWith("..") ||
        relativeFilePath.includes("..")
      ) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer)
  );
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopStaticServer() {
  await new Promise((resolveServer, reject) =>
    server.close((error) => (error ? reject(error) : resolveServer()))
  );
  await rm(siteDirectory, { recursive: true, force: true });
}

async function assertNoHorizontalOverflow(page, routeName) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      viewport: window.innerWidth,
      documentWidth: root.scrollWidth,
      bodyWidth: document.body?.scrollWidth ?? 0
    };
  });
  const contentWidth = Math.max(geometry.documentWidth, geometry.bodyWidth);
  expect(
    contentWidth,
    `${routeName} overflows horizontally: ${JSON.stringify(geometry)}`
  ).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function flowViolations(page) {
  return page.locator(".product-card").evaluateAll((cards) =>
    cards.flatMap((card) => {
      const content = card
        .querySelector(".product-card-content")
        ?.getBoundingClientRect();
      const actions = card
        .querySelector(".product-actions")
        ?.getBoundingClientRect();
      if (!content || !actions || actions.top >= content.bottom - 1) return [];
      return [card.dataset.product ?? "unknown"];
    })
  );
}

async function rectangleCollision(page, selector) {
  return page.locator(selector).evaluate((section) => {
    const [copy, actions] = section.children;
    if (!copy || !actions) return false;
    const first = copy.getBoundingClientRect();
    const second = actions.getBoundingClientRect();
    return (
      Math.min(first.right, second.right) >
        Math.max(first.left, second.left) + 1 &&
      Math.min(first.bottom, second.bottom) >
        Math.max(first.top, second.top) + 1
    );
  });
}

test.beforeAll(async () => {
  await buildFixtureSite();
  await startStaticServer(siteDirectory);
});

test.afterAll(async () => {
  await stopStaticServer();
});

const routes = [
  {
    name: "home EN desktop",
    path: "/en/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) => expect(page.locator(".product-card")).toHaveCount(8),
    home: true,
    screenshot: true
  },
  {
    name: "home JA desktop",
    path: "/ja/",
    locale: "ja",
    viewport: { width: 1440, height: 1000 },
    ready: (page) => expect(page.locator(".product-card")).toHaveCount(8),
    home: true
  },
  {
    name: "home JA mobile",
    path: "/ja/",
    locale: "ja",
    viewport: { width: 390, height: 844 },
    ready: (page) => expect(page.locator(".product-card")).toHaveCount(8),
    home: true
  },
  {
    name: "home EN narrow mobile",
    path: "/en/",
    locale: "en",
    viewport: { width: 320, height: 740 },
    ready: (page) => expect(page.locator(".product-card")).toHaveCount(8),
    home: true
  },
  {
    name: "Engineering desktop",
    path: "/en/engineering/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) => expect(page.locator(".engineering-product")).toHaveCount(8)
  },
  {
    name: "Engineering JA mobile",
    path: "/ja/engineering/",
    locale: "ja",
    viewport: { width: 390, height: 844 },
    ready: (page) => expect(page.locator(".engineering-product")).toHaveCount(8)
  },
  {
    name: "Majiwari product desktop",
    path: "/en/products/majiwari/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) => expect(page.locator("h1")).toHaveText("Majiwari")
  },
  {
    name: "Wabachi product desktop",
    path: "/en/products/wabachi/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) => expect(page.locator("h1")).toHaveText("Wabachi"),
    product: true
  },
  {
    name: "Shikitari product JA narrow mobile",
    path: "/ja/products/shikitari/",
    locale: "ja",
    viewport: { width: 320, height: 740 },
    ready: (page) => expect(page.locator("h1")).toHaveText("Shikitari"),
    product: true
  },
  {
    name: "Work desktop",
    path: "/en/work/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) =>
      expect(page.locator("#issue-list .issue-row")).toHaveCount(
        expectedIssueCount
      )
  },
  {
    name: "Governance desktop",
    path: "/en/work/governance/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) =>
      expect(
        page.locator("#repository-health .governance-repository")
      ).toHaveCount(expectedRepositoryCount)
  },
  {
    name: "Graph desktop",
    path: "/en/work/graph/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) =>
      expect(page.locator("#dependency-graph .graph-node")).toHaveCount(
        expectedIssueCount
      )
  }
];

for (const route of routes) {
  test(route.name, async ({ page }) => {
    await page.setViewportSize(route.viewport);
    await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts?.ready);
    await expect(page.locator("html")).toHaveAttribute("lang", route.locale);
    await route.ready(page);
    await assertNoHorizontalOverflow(page, route.name);

    if (route.home) {
      expect(
        await flowViolations(page),
        `${route.name} has card action overlap`
      ).toEqual([]);
      expect(
        await rectangleCollision(page, ".work-strip"),
        `${route.name} has Work CTA collision`
      ).toBe(false);
      const heroBox = await page.locator(".hero-art").boundingBox();
      expect(
        heroBox?.width,
        `${route.name} has no Hero identity width`
      ).toBeGreaterThan(180);
      await expect(page.locator(".hero-art-image")).toHaveCount(2);
      for (const image of await page.locator(".hero-art-image").all()) {
        await expect(image).toBeVisible();
        expect(
          await image.evaluate(
            (element) => element.complete && element.naturalWidth > 0
          ),
          `${route.name} Hero artwork did not load`
        ).toBe(true);
      }
      const visual = await page.locator(".hero-art").evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const images = [...element.querySelectorAll(".hero-art-image")];
        const footer = element.querySelector(".hero-art-shade");
        return {
          imageBands: images.map((image) => {
            const bounds = image.getBoundingClientRect();
            return [
              Math.round(((bounds.top - frame.top) / frame.height) * 100),
              Math.round((bounds.height / frame.height) * 100)
            ];
          }),
          footerBand: Math.round(
            ((footer.getBoundingClientRect().top - frame.top) / frame.height) *
              100
          ),
          footerColor: getComputedStyle(footer).backgroundColor
        };
      });
      expect(visual).toEqual({
        imageBands: [
          [0, 40],
          [40, 40]
        ],
        footerBand: 80,
        footerColor: "rgb(12, 29, 37)"
      });
      await expect(
        page.locator(
          '[data-product="mottainai"] .product-identity[data-identity-source="curated"]'
        )
      ).toBeVisible();
      await expect(
        page.locator(
          '[data-product="cli-canon"] .product-identity[data-identity-source="fallback"]'
        )
      ).toBeVisible();
    }
    if (route.product) {
      expect(
        await rectangleCollision(page, ".product-next"),
        `${route.name} has Product CTA collision`
      ).toBe(false);
      await expect(page.locator(".product-work")).toBeVisible();
      const identity = page.locator(".product-hero-identity");
      await expect(identity).toBeVisible();
      expect(
        await identity.evaluate((element) => {
          const image = element.querySelector("img");
          return image
            ? image.complete && image.naturalWidth > 0
            : Boolean(element.textContent?.trim());
        }),
        `${route.name} has no visible product identity`
      ).toBe(true);
    }

    if (route.screenshot) {
      await page.locator(".work-strip").evaluate((element) => {
        const top = element.getBoundingClientRect().top;
        // Keep the existing Work image comparison on the same device-pixel phase
        // after the new Atlas imagery changes its position down the page.
        element.style.transform = `translateY(${Math.ceil(top) - 1 / 64 - top}px)`;
      });
      await expect(page.locator(".work-strip")).toHaveScreenshot(
        "home-en-work-strip.png",
        { maxDiffPixels: 1500 }
      );
    }
  });
}

test("Engineering shows repository counts and Actions provenance with absence and failure states", async ({
  page
}) => {
  await page.goto(`${baseUrl}/en/engineering/`, { waitUntil: "networkidle" });
  const productMetric = (product, label) =>
    page.locator(`#${product} .engineering-metric`).filter({
      has: page.locator(".metric-label").getByText(label, { exact: true })
    });
  const measured = productMetric("mottainai", "Source files");
  await expect(measured).toHaveAttribute("data-metric-state", "available");
  await expect(measured.locator(".metric-value")).toHaveText("1");
  await expect(measured.locator(".metric-provenance")).toContainText(
    ENGINEERING_REVISION
  );
  const verification = productMetric("mottainai", "Verification status");
  await expect(verification).toHaveAttribute("data-metric-state", "available");
  await expect(verification.locator(".metric-provenance a")).toHaveAttribute(
    "href",
    "https://github.com/yohn-jp/mottainai/actions/runs/42"
  );
  await expect(verification.locator(".metric-provenance")).toContainText(
    ENGINEERING_REVISION
  );
  await expect(
    productMetric("nawabari", "Verification status")
  ).toHaveAttribute("data-metric-state", "stale");
  await expect(productMetric("nawabari", "Test LOC")).toHaveAttribute(
    "data-metric-state",
    "partial"
  );
  await expect(
    productMetric("inari", "Verification status").locator(".metric-value")
  ).toHaveText("cancelled");
  await expect(
    productMetric("cli-canon", "Verification status")
  ).toHaveAttribute("data-metric-state", "unavailable");
  await expect(
    productMetric("suzukuri", "Verification status")
  ).toHaveAttribute("data-metric-state", "failed");
  const engineering = await page.evaluate(async () =>
    (await fetch("../data/engineering.json")).json()
  );
  expect(engineering.summary.sourceLoc.status).toBe("available");
  expect(engineering.summary.testLoc.status).toBe("partial");
  expect(engineering.summary.verificationDuration.status).toBe("partial");
});

test("Home and Product content remain visible with JavaScript disabled", async ({
  browser
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/ja/`, { waitUntil: "networkidle" });
    await expect(page.locator("#hero-title")).toBeVisible();
    await expect(page.locator("#products-heading")).toBeVisible();
    await expect(page.locator(".product-card")).toHaveCount(8);
    await page.goto(`${baseUrl}/ja/products/wabachi/`, {
      waitUntil: "networkidle"
    });
    await expect(page.locator("h1")).toHaveText("Wabachi");
    await expect(page.locator(".product-why")).toBeVisible();
    await expect(page.locator(".product-hero-identity")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("mobile menu keeps Engineering reachable and keyboard focus visible", async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${baseUrl}/ja/`, { waitUntil: "networkidle" });
  await page.locator(".mobile-nav summary").click();
  await page.locator(".mobile-nav-links a[href='./engineering/']").click();
  await expect(page).toHaveURL(/\/ja\/engineering\/$/);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    return (
      element instanceof HTMLElement &&
      getComputedStyle(element).outlineStyle !== "none"
    );
  });
  expect(focused).toBe(true);
});
