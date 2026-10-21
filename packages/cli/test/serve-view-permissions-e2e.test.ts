import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { linkPackage } from "@actiondock/core/registry";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

async function getAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolvePort(port);
      });
    });
    server.on("error", reject);
  });
}

function parseMcpPayload(rawText: string): any {
  if (rawText.startsWith("event:")) {
    const dataLine = rawText.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(dataLine ? dataLine.slice(5).trim() : rawText);
  }
  return JSON.parse(rawText);
}

async function sendMcpRequest(
  url: string,
  token: string,
  payload: any,
  sessionId?: string | null
): Promise<{ status: number; data: any; sessionId: string | null; rawText: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const newSessionId = res.headers.get("mcp-session-id") || sessionId || null;
  const rawText = await res.text();
  let data: any = null;
  try {
    data = parseMcpPayload(rawText);
  } catch {
    // 非 JSON 或空白响应
  }
  return { status: res.status, data, sessionId: newSessionId, rawText };
}

/**
 * ad serve 视图并集授权端到端验证：
 * 外部视图文件承载 packageAllowlist/actionAllowlist 声明，附加包真实装载，
 * HTTP 与 MCP 双通道按整包 + 全限定单动作并集收敛。
 */
describe("ad serve 视图并集授权端到端集成测试", () => {
  let tempHome: string;
  let tempDataDir: string;
  let readPkgDir: string;
  let writePkgDir: string;
  let viewsFilePath: string;
  let serveProc: ChildProcess | undefined;

  const AGENT_TOKEN = "agent-access-token-2026";
  const MASTER_TOKEN = "master-access-token-2026";

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), "ad-access-home-"));
    tempDataDir = mkdtempSync(join(tmpdir(), "ad-access-data-"));
    readPkgDir = mkdtempSync(join(tmpdir(), "ad-pkg-read-"));
    writePkgDir = mkdtempSync(join(tmpdir(), "ad-pkg-write-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");

    // 1. 构建 read-pkg（整包授权）
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(readPkgDir, "node_modules"), "junction");
    }
    mkdirSync(join(readPkgDir, "actions"), { recursive: true });
    writeFileSync(
      join(readPkgDir, "actiondock.json"),
      JSON.stringify({
        id: "test.read-pkg",
        name: "Read Package",
        version: "1.0.0",
        schemaVersion: 2,
        actions: {
          "read-a": { entry: "actions/read-a.ts", description: "读取 A" },
          "read-b": { entry: "actions/read-b.ts", description: "读取 B" },
        },
        playbooks: {
          "read-sop": { entry: "playbooks/read-sop.md", description: "读取规程" },
        },
      })
    );
    writeFileSync(
      join(readPkgDir, "actions", "read-a.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction({ id: "read-a", async run() { return { op: "read-a" }; } });
`
    );
    writeFileSync(
      join(readPkgDir, "actions", "read-b.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction({ id: "read-b", async run() { return { op: "read-b" }; } });
`
    );
    mkdirSync(join(readPkgDir, "playbooks"), { recursive: true });
    writeFileSync(join(readPkgDir, "playbooks", "read-sop.md"), "# Read SOP");

    // 2. 构建 write-pkg（仅 read 单动作授权；write 动作未授权）
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(writePkgDir, "node_modules"), "junction");
    }
    mkdirSync(join(writePkgDir, "actions"), { recursive: true });
    writeFileSync(
      join(writePkgDir, "actiondock.json"),
      JSON.stringify({
        id: "test.write-pkg",
        name: "Write Package",
        version: "1.0.0",
        schemaVersion: 2,
        actions: {
          read: { entry: "actions/read.ts", description: "读取" },
          write: { entry: "actions/write.ts", description: "写入" },
        },
        playbooks: {
          "write-sop": { entry: "playbooks/write-sop.md", description: "写入规程" },
        },
        config: {
          writeKey: { type: "string", default: "write-secret" },
        },
      })
    );
    writeFileSync(
      join(writePkgDir, "actions", "read.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction({ id: "read", async run() { return { op: "w-read" }; } });
`
    );
    writeFileSync(
      join(writePkgDir, "actions", "write.ts"),
      `import { defineAction } from "@actiondock/sdk";
export default defineAction({ id: "write", async run() { return { op: "w-write" }; } });
`
    );
    mkdirSync(join(writePkgDir, "playbooks"), { recursive: true });
    writeFileSync(join(writePkgDir, "playbooks", "write-sop.md"), "# Write CLASSIFIED SOP");

    // 3. 链接至全局测试环境
    await linkPackage(readPkgDir, tempHome);
    await linkPackage(writePkgDir, tempHome);

    // 4. 外部视图文件：agent 视图声明 A 整包 + B/read 全限定单动作（并集授权）
    viewsFilePath = join(tempHome, "access-views.json");
    writeFileSync(
      viewsFilePath,
      JSON.stringify({
        views: {
          agent: {
            token: AGENT_TOKEN,
            packageAllowlist: ["test.read-pkg"],
            actionAllowlist: ["test.write-pkg/read"],
          },
        },
      })
    );
  });

  afterEach(async () => {
    if (serveProc) {
      const proc = serveProc;
      serveProc = undefined;
      if (proc.exitCode === null && proc.signalCode === null) {
        await new Promise<void>((resolveExit) => {
          let timer: NodeJS.Timeout | null = null;
          const onExit = () => {
            if (timer) clearTimeout(timer);
            resolveExit();
          };
          proc.once("exit", onExit);
          proc.kill("SIGTERM");
          timer = setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) {
              proc.kill("SIGKILL");
            }
            resolveExit();
          }, 500);
        });
      }
    }

    for (const dir of [tempHome, tempDataDir, readPkgDir, writePkgDir]) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
        } catch {
          // 忽略临时目录清理异常
        }
      }
    }
  });

  const waitReady = async (serverUrl: string, token: string, getBanner: () => string) => {
    let lastStatus = 0;
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`${serverUrl}/api/v2/health`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        lastStatus = res.status;
        if (res.status === 200 && getBanner().includes("* Views:")) {
          return true;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    console.error(`[waitReady] last health status: ${lastStatus}, views in banner: ${getBanner().includes("* Views:")}`);
    return false;
  };

  it("通过 --views-file 的并集授权启动：附加包装载、HTTP 并集边界与 MCP 工具/规程隔离", async () => {
    const port = await getAvailablePort();
    const serverUrl = `http://127.0.0.1:${port}`;

    let bannerOutput = "";
    serveProc = spawn(
      process.execPath,
      [
        cliPath,
        "serve",
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--views-file",
        viewsFilePath,
        "--token",
        MASTER_TOKEN,
        "--data-dir",
        tempDataDir,
      ],
      {
        cwd: tempHome,
        env: {
          ...process.env,
          ACTIONDOCK_HOME: tempHome,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    serveProc.stdout?.on("data", (chunk) => {
      bannerOutput += chunk.toString();
    });
    serveProc.stderr?.on("data", (chunk) => {
      bannerOutput += chunk.toString();
    });

    const ready = await waitReady(serverUrl, MASTER_TOKEN, () => bannerOutput);
    if (!ready) {
      assert.fail(`Server not ready. Output: ${bannerOutput.slice(0, 800)}`);
    }

    const agentHeaders = { Authorization: `Bearer ${AGENT_TOKEN}` };

    // 1. 附加包装载验证：授权引用的两包均已加载且按并集可见
    const actionsRes = await fetch(`${serverUrl}/views/agent/api/v2/actions`, { headers: agentHeaders });
    assert.strictEqual(actionsRes.status, 200);
    const actions: any[] = await actionsRes.json();
    const ids = actions.map((a) => a.id).sort();
    assert.deepStrictEqual(ids, ["test.read-pkg/read-a", "test.read-pkg/read-b", "test.write-pkg/read"]);

    // 2. info 投影：read-pkg 完整、write-pkg 最小身份元数据
    const infoRes = await fetch(`${serverUrl}/views/agent/api/v2/info`, { headers: agentHeaders });
    assert.strictEqual(infoRes.status, 200);
    const infoData: any = await infoRes.json();
    const pkgIds = infoData.packages.map((p: any) => p.id).sort();
    assert.deepStrictEqual(pkgIds, ["test.read-pkg", "test.write-pkg"]);
    const writePkg = infoData.packages.find((p: any) => p.id === "test.write-pkg");
    assert.deepStrictEqual(writePkg.actions, ["read"]);
    assert.strictEqual(writePkg.config, undefined);
    assert.strictEqual(writePkg.playbooks, undefined);

    // 3. 执行边界：A 全部动作与 B/read 放行；B/write 拒绝
    const runA = await fetch(`${serverUrl}/views/agent/api/v2/actions/read-a/run`, {
      method: "POST",
      headers: { ...agentHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    assert.strictEqual(runA.status, 200);

    const runBRead = await fetch(`${serverUrl}/views/agent/api/v2/packages/test.write-pkg/actions/read/run`, {
      method: "POST",
      headers: { ...agentHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    assert.strictEqual(runBRead.status, 200);

    const runBWrite = await fetch(`${serverUrl}/views/agent/api/v2/packages/test.write-pkg/actions/write/run`, {
      method: "POST",
      headers: { ...agentHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    assert.strictEqual(runBWrite.status, 403);

    // 4. 规程边界：B 的规程不开放
    const pbRes = await fetch(`${serverUrl}/views/agent/api/v2/playbooks`, { headers: agentHeaders });
    assert.strictEqual(pbRes.status, 200);
    const pbs: any[] = await pbRes.json();
    assert.ok(pbs.some((p) => p.id.includes("read-sop")));
    assert.ok(!pbs.some((p) => p.id.includes("write-sop")));

    // 5. MCP 工具隔离：仅注册并集工具，未授权工具不可调用
    const agentInit = await sendMcpRequest(`${serverUrl}/views/agent/mcp`, AGENT_TOKEN, {
      jsonrpc: "2.0",
      id: "agent-init",
      method: "initialize",
      params: {
        protocolVersion: "2026-07-08",
        capabilities: {},
        clientInfo: { name: "view-perm-test", version: "1.0" },
      },
    });
    assert.strictEqual(agentInit.status, 200);

    const agentTools = await sendMcpRequest(
      `${serverUrl}/views/agent/mcp`,
      AGENT_TOKEN,
      { jsonrpc: "2.0", id: "agent-tools", method: "tools/list", params: {} },
      agentInit.sessionId
    );
    assert.strictEqual(agentTools.status, 200);
    const toolNames = (agentTools.data?.result?.tools || []).map((t: any) => t.name);
    assert.strictEqual(toolNames.length, 3, `expected 3 tools got ${JSON.stringify(toolNames)}`);
    assert.ok(!toolNames.some((n: string) => n.toLowerCase().includes("write")), "write tool must not be registered");

    // 授权工具可调用
    const callOk = await sendMcpRequest(
      `${serverUrl}/views/agent/mcp`,
      AGENT_TOKEN,
      { jsonrpc: "2.0", id: "call-ok", method: "tools/call", params: { name: "read-a", arguments: {} } },
      agentInit.sessionId
    );
    assert.strictEqual(callOk.status, 200);
    assert.strictEqual(JSON.parse(callOk.data.result.content[0].text).ok, true);

    // 未授权工具调用被拒绝
    const forbiddenCall = await sendMcpRequest(
      `${serverUrl}/views/agent/mcp`,
      AGENT_TOKEN,
      { jsonrpc: "2.0", id: "call-bad", method: "tools/call", params: { name: "write", arguments: {} } },
      agentInit.sessionId
    );
    const forbiddenBlocked =
      forbiddenCall.data?.error !== undefined || forbiddenCall.data?.result?.isError === true;
    assert.strictEqual(forbiddenBlocked, true, `forbidden tool call must be rejected: ${forbiddenCall.rawText}`);

    // 6. MCP 规程防泄露：B 规程不得出现在资源与提示列表
    const resourcesRes = await sendMcpRequest(
      `${serverUrl}/views/agent/mcp`,
      AGENT_TOKEN,
      { jsonrpc: "2.0", id: "res-list", method: "resources/list", params: {} },
      agentInit.sessionId
    );
    const resourceUris = JSON.stringify(resourcesRes.data?.result?.resources || []);
    assert.ok(!resourceUris.includes("write-sop"), "B playbook must not leak via MCP resources");

    const promptsRes = await sendMcpRequest(
      `${serverUrl}/views/agent/mcp`,
      AGENT_TOKEN,
      { jsonrpc: "2.0", id: "prompt-list", method: "prompts/list", params: {} },
      agentInit.sessionId
    );
    const promptNames = JSON.stringify(promptsRes.data?.result?.prompts || []);
    assert.ok(!promptNames.includes("write-sop"), "B playbook must not leak via MCP prompts");

    // 7. 根路径 token 智能匹配同样按并集收敛
    const rootRes = await fetch(`${serverUrl}/api/v2/actions`, { headers: agentHeaders });
    assert.strictEqual(rootRes.status, 200);
    const rootActions: any[] = await rootRes.json();
    assert.strictEqual(rootActions.length, 3);
    const defaultRes = await fetch(`${serverUrl}/api/v2/actions`, {
      headers: { Authorization: `Bearer ${MASTER_TOKEN}` },
    });
    assert.strictEqual(defaultRes.status, 200);
    assert.deepStrictEqual(await defaultRes.json(), [], "默认视图未声明授权，不得回退全开放");
  });

  it("不完整动作授权在启动时明确拒绝", async () => {
    writeFileSync(viewsFilePath, JSON.stringify({
      views: { invalid: { token: "invalid-token", actionAllowlist: ["read"] } },
    }));
    const port = await getAvailablePort();
    const proc = spawn(process.execPath, [
      cliPath, "serve", "--port", String(port), "--views-file", viewsFilePath,
      "--data-dir", tempDataDir,
    ], {
      cwd: tempHome,
      env: { ...process.env, ACTIONDOCK_HOME: tempHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serveProc = proc;
    let errors = "";
    proc.stderr!.on("data", (chunk) => { errors += chunk.toString(); });
    const code = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => reject(new Error("Invalid configuration did not terminate startup")), 20_000);
      proc.once("exit", (result) => { clearTimeout(timeout); resolveExit(result); });
      proc.once("error", (error) => { clearTimeout(timeout); reject(error); });
    });
    assert.notStrictEqual(code, 0);
    assert.ok(errors.includes("actionAllowlist"), errors);
  });
});
