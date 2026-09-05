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
      ".svg": "image/svg+xml"
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
    ready: (page) => expect(page.locator(".product-card")).toHaveCount(6),
    home: true,
    screenshot: true
  },
  {
    name: "home JA desktop",
    path: "/ja/",
    locale: "ja",
    viewport: { width: 1440, height: 1000 },
    ready: (page) => expect(page.locator(".product-card")).toHaveCount(6),
    home: true
  },
  {
    name: "home JA mobile",
    path: "/ja/",
    locale: "ja",
    viewport: { width: 390, height: 844 },
    ready: (page) => expect(page.locator(".product-card")).toHaveCount(6),
    home: true
  },
  {
    name: "Majiwari product desktop",
    path: "/en/products/majiwari/",
    locale: "en",
    viewport: { width: 1440, height: 1000 },
    ready: (page) => expect(page.locator("h1")).toHaveText("Majiwari")
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
    }

    if (route.screenshot) {
      await expect(page.locator(".work-strip")).toHaveScreenshot(
        "home-en-work-strip.png"
      );
    }
  });
}
