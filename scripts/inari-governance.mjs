import {
  GitHubAdapter,
  readGovernedExistingArtifact,
  projectExistingArtifact
} from "gh-inari";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
export const INARI_GOVERNANCE_AUTHORITY = "Inari";

function issueKey(repository, number) {
  return `${repository.fullName}#${number}`;
}

function errorMessage(error) {
  return String(error?.message ?? error).slice(0, 500);
}

function unavailableGovernance(reason) {
  return {
    authority: INARI_GOVERNANCE_AUTHORITY,
    status: "unavailable",
    valid: null,
    classification: "unknown",
    template: null,
    violations: [],
    revision: null,
    reason
  };
}

function projectGovernance(read) {
  const projection = projectExistingArtifact(read.result);
  const violations = projection.violations ?? projection.diagnostics ?? [];
  return {
    authority: INARI_GOVERNANCE_AUTHORITY,
    status: projection.valid ? "valid" : "invalid",
    valid: projection.valid,
    classification: projection.classification,
    template: read.contract?.templateIdentity ?? null,
    violations,
    revision:
      read.contract?.provenance?.treeSha ?? read.governanceRevision ?? null,
    reason: null
  };
}

class FetchGithubTransport {
  constructor({ fetchImpl, token, issues }) {
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.issues = issues;
    this.cache = new Map();
  }

  async run(args) {
    if (args[0] === "--version") {
      return {
        exitCode: 0,
        stdout: "gh version inari-transport\n",
        stderr: ""
      };
    }
    if (args[0] === "auth" && args[1] === "status") {
      return this.token
        ? { exitCode: 0, stdout: "Logged in\n", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "not logged in" };
    }
    if (args[0] !== "api" || typeof args[1] !== "string") {
      return { exitCode: 1, stdout: "", stderr: "unsupported gh invocation" };
    }

    const endpoint = args[1];
    const methodIndex = args.indexOf("--method");
    const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
    const hostnameIndex = args.indexOf("--hostname");
    const hostname =
      hostnameIndex === -1 ? "github.com" : args[hostnameIndex + 1];
    const baseUrl =
      hostname === "github.com" ? API_ROOT : `https://${hostname}/api/v3`;
    const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const cacheKey = `${method}:${url}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const issueMatch = endpoint.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
    if (method === "GET" && issueMatch) {
      const rawIssue = this.issues.get(
        issueKey({ fullName: issueMatch[1] }, Number(issueMatch[2]))
      );
      if (rawIssue !== undefined) {
        const result = {
          exitCode: 0,
          stdout: JSON.stringify(rawIssue),
          stderr: ""
        };
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "yohn-jp-issue-dashboard"
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(url, { headers });
    const body = await response.text();
    const result = response.ok
      ? { exitCode: 0, stdout: body, stderr: "" }
      : { exitCode: 1, stdout: "", stderr: body || `HTTP ${response.status}` };
    if (response.ok && endpoint.includes("/git/trees/")) {
      try {
        this.governanceRevision = JSON.parse(body)?.sha ?? null;
      } catch {
        this.governanceRevision = null;
      }
    }
    this.cache.set(cacheKey, result);
    return result;
  }
}

export function createIssueGovernanceReader({
  repository,
  fetchImpl = globalThis.fetch,
  token = "",
  rawIssues = []
}) {
  const issues = new Map(
    rawIssues.map((issue) => [issueKey(repository, issue.number), issue])
  );
  const transport = new FetchGithubTransport({ fetchImpl, token, issues });
  const adapter = new GitHubAdapter({
    repository: repository.fullName,
    transport
  });
  return async (number) => ({
    ...(await readGovernedExistingArtifact(adapter, "issue", number)),
    governanceRevision: transport.governanceRevision ?? null
  });
}

export async function collectIssueGovernance({
  issue,
  repository,
  rawIssues = [],
  fetchImpl = globalThis.fetch,
  token = "",
  reader
}) {
  if (!token) return unavailableGovernance("authentication-unavailable");
  try {
    const read = await (
      reader ??
      createIssueGovernanceReader({ repository, fetchImpl, token, rawIssues })
    )(issue.number);
    return projectGovernance(read);
  } catch (error) {
    return unavailableGovernance(`inari-unavailable: ${errorMessage(error)}`);
  }
}
