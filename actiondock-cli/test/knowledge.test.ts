import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliDir = path.resolve(import.meta.dirname, "..");

let server: http.Server;
let baseUrl = "";
const requests: Array<{ method?: string; url?: string; body?: unknown; bodyText?: string }> = [];

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const bodyText = await readBody(req);
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    requests.push({ method: req.method, url: req.url ?? "", body, bodyText });

    if (req.method === "GET" && req.url === "/api/repositories/knowledge") {
      return json(res, {
        status: 0, msg: "ok",
        data: [
          { repositoryId: "repo-1", knowledgeId: "api-docs", displayName: "API 文档", description: "接口规范", tags: ["api"], knowledgePath: "knowledge/api-docs/knowledge.json", source: { type: "GIT", url: "https://github.com/team/api-docs.git", branch: "main", entryPath: "ACTIONDOCK.md" }, installed: false, installedRepositoryId: null, trusted: true },
          { repositoryId: "repo-2", knowledgeId: "arch-docs", displayName: "架构文档", description: "系统架构", tags: ["arch"], knowledgePath: "knowledge/arch-docs/knowledge.json", source: { type: "GIT", url: "https://github.com/team/arch.git", branch: "main" }, installed: true, installedRepositoryId: "knowledge:repo-2:arch-docs", trusted: false }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/repositories/repo-1/knowledge") {
      return json(res, {
        status: 0, msg: "ok",
        data: [
          { repositoryId: "repo-1", knowledgeId: "api-docs", displayName: "API 文档", description: "接口规范", tags: ["api"], knowledgePath: "knowledge/api-docs/knowledge.json", source: { type: "GIT", url: "https://github.com/team/api-docs.git", branch: "main", entryPath: "ACTIONDOCK.md" }, installed: false, installedRepositoryId: null, trusted: true }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/repositories/repo-1/knowledge/api-docs") {
      return json(res, {
        status: 0, msg: "ok",
        data: {
          descriptor: { repositoryId: "repo-1", knowledgeId: "api-docs", displayName: "API 文档", description: "接口规范", tags: ["api"], knowledgePath: "knowledge/api-docs/knowledge.json", source: { type: "GIT", url: "https://github.com/team/api-docs.git", branch: "main", entryPath: "ACTIONDOCK.md" }, installed: false, installedRepositoryId: null, trusted: true },
          knowledge: { schemaVersion: 1, knowledgeId: "api-docs", displayName: "API 文档", description: "接口规范", source: { type: "GIT", url: "https://github.com/team/api-docs.git", branch: "main", entryPath: "ACTIONDOCK.md" }, tags: ["api"] }
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/repositories/repo-1/knowledge/api-docs/install") {
      return json(res, {
        status: 0, msg: "知识源安装完成",
        data: { repositoryId: "repo-1", knowledgeId: "api-docs", displayName: "API 文档", description: "接口规范", tags: ["api"], knowledgePath: "knowledge/api-docs/knowledge.json", source: { type: "GIT", url: "https://github.com/team/api-docs.git", branch: "main", entryPath: "ACTIONDOCK.md" }, installed: true, installedRepositoryId: "knowledge:repo-1:api-docs", trusted: true }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/repositories/repo-2/knowledge/arch-docs") {
      return json(res, { status: 0, msg: "知识源已卸载", data: null });
    }

    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const addr = server.address();
  if (addr && typeof addr === "object") {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(() => server.close());

describe("repository:knowledge-list", () => {
  it("lists all knowledge entries", async () => {
    const output = await runCli(["repository:knowledge-list", "--server", baseUrl, "--json"]);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].knowledgeId).toBe("api-docs");
    expect(parsed[1].knowledgeId).toBe("arch-docs");
  });

  it("lists knowledge for a specific repository", async () => {
    const output = await runCli(["repository:knowledge-list", "--server", baseUrl, "--repository-id", "repo-1", "--json"]);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].knowledgeId).toBe("api-docs");
  });
});

describe("repository:knowledge-get", () => {
  it("gets knowledge entry detail", async () => {
    const output = await runCli(["repository:knowledge-get", "--server", baseUrl, "--repository-id", "repo-1", "--knowledge-id", "api-docs", "--json"]);
    const parsed = JSON.parse(output);
    expect(parsed.descriptor.knowledgeId).toBe("api-docs");
    expect(parsed.knowledge.source.url).toBe("https://github.com/team/api-docs.git");
  });
});

describe("repository:knowledge-install", () => {
  it("installs a knowledge entry", async () => {
    const output = await runCli(["repository:knowledge-install", "--server", baseUrl, "--repository-id", "repo-1", "--knowledge-id", "api-docs", "--json"]);
    const parsed = JSON.parse(output);
    expect(parsed.installed).toBe(true);
    expect(parsed.installedRepositoryId).toBe("knowledge:repo-1:api-docs");
  });
});

describe("repository:knowledge-uninstall", () => {
  it("uninstalls a knowledge entry", async () => {
    const output = await runCli(["repository:knowledge-uninstall", "--server", baseUrl, "--repository-id", "repo-2", "--knowledge-id", "arch-docs", "--json"]);
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(true);
  });
});

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = path.join(cliDir, "bin/dev.js");
    const child = spawn("node", [bin, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`CLI exited with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
  });
}

function json(res: http.ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
