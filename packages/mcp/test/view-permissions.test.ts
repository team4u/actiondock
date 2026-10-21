import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createPackageRuntime } from "@actiondock/core/package";
import { createActionDockHost } from "@actiondock/core/server";
import { linkPackage } from "@actiondock/core/registry";
import { createActionDockMcpServer } from "../src/adapter";
import { mapAndFilterActions } from "../src/tool-mapper";
import { resolveService } from "../src/service-resolver";

async function connect(server: Awaited<ReturnType<typeof createActionDockMcpServer>>) {
  const [client, transport] = InMemoryTransport.createLinkedPair();
  let sequence = 0;
  const pending = new Map<number, (message: any) => void>();
  client.onmessage = (message: any) => pending.get(message.id)?.(message);
  await server.connect(transport);
  const request = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 3000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(message);
      });
      Promise.resolve(client.send({ jsonrpc: "2.0", id, method, params })).catch((error) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
    });
  };
  await request("initialize", {
    protocolVersion: "2026-07-08",
    capabilities: {},
    clientInfo: { name: "permission-test", version: "1.0" },
  });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return request;
}

const permission = {
  packageAllowlist: ["mcp.pkg.a"],
  actionAllowlist: ["mcp.pkg.b/read"],
};

describe("MCP 包与动作并集授权", () => {
  let host: Awaited<ReturnType<typeof createActionDockHost>>;
  let forbiddenCalls = 0;
  let root: string;
  let projectA: string;
  let projectB: string;
  let registryHome: string;

  before(async () => {
    const createPackage = async (id: string, side: string) => createPackageRuntime({
      projectConfig: {
        id,
        name: id,
        version: "1.0.0",
        actions: { read: { entry: "", description: "read" }, write: { entry: "", description: "write" } },
        playbooks: {
          [`${side}-sop`]: { description: `${side} SOP`, actions: ["read"], content: `# ${side} SOP` },
        } as any,
      },
      actions: {
        read: defineAction({ run: () => ({ side, op: "read" }) }),
        write: defineAction({ run: () => {
          if (side === "b") forbiddenCalls++;
          return { side, op: "write" };
        } }),
      },
      inMemory: true,
    });
    host = await createActionDockHost({
      packages: [await createPackage("mcp.pkg.a", "a"), await createPackage("mcp.pkg.b", "b")],
      autoLoadCurrentProject: false,
      inMemory: true,
    });
    root = mkdtempSync(join(tmpdir(), "mcp-permission-"));
    projectA = join(root, "project-a");
    projectB = join(root, "project-b");
    registryHome = join(root, "home");
    for (const [directory, id, actionId] of [
      [projectA, "linked.pkg.x", "op"],
      [projectB, "linked.pkg.y", "read"],
    ]) {
      mkdirSync(join(directory, "actions"), { recursive: true });
      writeFileSync(join(directory, "actiondock.json"), JSON.stringify({
        id, name: id, version: "1.0.0", schemaVersion: 2,
        actions: { [actionId]: { entry: `actions/${actionId}.ts`, description: actionId } },
      }));
      writeFileSync(join(directory, "actions", `${actionId}.ts`), `export default {run: () => ({})};`);
    }
    mkdirSync(registryHome);
    await linkPackage(projectB, registryHome);
  });

  after(async () => {
    await host?.close();
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });

  it("纯工具映射统一取并集，空授权不回退为全部", () => {
    const actions = [
      { id: "mcp.pkg.a/read", packageId: "mcp.pkg.a" },
      { id: "mcp.pkg.a/write", packageId: "mcp.pkg.a" },
      { id: "mcp.pkg.b/read", packageId: "mcp.pkg.b" },
      { id: "mcp.pkg.b/write", packageId: "mcp.pkg.b" },
    ];
    assert.deepEqual(mapAndFilterActions(actions), []);
    assert.deepEqual(
      mapAndFilterActions(actions, permission.packageAllowlist, permission.actionAllowlist).map((item) => item.action.id),
      ["mcp.pkg.a/read", "mcp.pkg.a/write", "mcp.pkg.b/read"]
    );
    assert.equal(mapAndFilterActions(actions, ["*"]).length, 4);
  });

  it("未声明任何授权时真实 MCP 工具列表为空", async () => {
    const server = await createActionDockMcpServer({ service: host });
    try {
      const request = await connect(server);
      assert.deepEqual((await request("tools/list")).result.tools, []);
    } finally { await server.close(); }
  });

  it("真实工具列表包含整包及额外单动作，主包选择不截断授权", async () => {
    const server = await createActionDockMcpServer({ service: host, packageId: "mcp.pkg.a", ...permission });
    try {
      const request = await connect(server);
      const names = (await request("tools/list")).result.tools.map((tool: any) => tool.name);
      assert.equal(names.length, 3);
      assert.ok(names.includes("mcp_pkg_a_read"));
      assert.ok(names.includes("mcp_pkg_b_read"));
      assert.ok(names.includes("write"));
    } finally { await server.close(); }
  });

  it("额外授权动作可执行，禁止工具调用不能触发底层执行", async () => {
    const server = await createActionDockMcpServer({ service: host, ...permission });
    try {
      const request = await connect(server);
      const result = (await request("tools/call", { name: "mcp_pkg_b_read", arguments: {} })).result;
      assert.notEqual(result.isError, true);
      assert.equal(JSON.parse(result.content[0].text).data.side, "b");
      const before = forbiddenCalls;
      const rejected = await request("tools/call", { name: "mcp_pkg_b_write", arguments: {} });
      assert.ok(rejected.error || rejected.result?.isError);
      assert.equal(forbiddenCalls, before);
    } finally { await server.close(); }
  });

  it("单动作授权不开放所属包的规程资源与提示", async () => {
    const server = await createActionDockMcpServer({ service: host, ...permission });
    try {
      const request = await connect(server);
      const resources = (await request("resources/list")).result.resources;
      const prompts = (await request("prompts/list")).result.prompts;
      assert.ok(resources.some((resource: any) => resource.uri.includes("a-sop")));
      assert.ok(resources.every((resource: any) => !resource.uri.includes("b-sop")));
      assert.ok(prompts.some((prompt: any) => prompt.name.includes("a-sop")));
      assert.ok(prompts.every((prompt: any) => !prompt.name.includes("b-sop")));
    } finally { await server.close(); }
  });

  it("独立全量标记开放全部已装载工具与规程", async () => {
    const server = await createActionDockMcpServer({ service: host, packageAllowlist: ["*"] });
    try {
      const request = await connect(server);
      assert.equal((await request("tools/list")).result.tools.length, 4);
      assert.ok((await request("prompts/list")).result.prompts.some((prompt: any) => prompt.name.includes("b-sop")));
    } finally { await server.close(); }
  });

  it("初始化前拒绝非法白名单与不完整动作引用", async () => {
    for (const options of [
      { packageAllowlist: null }, { packageAllowlist: "mcp.pkg.a" },
      { actionAllowlist: null }, { actionAllowlist: ["read"] }, { actionAllowlist: ["mcp.pkg.b/*"] },
    ]) {
      await assert.rejects(createActionDockMcpServer({ service: host, ...options } as any), { code: "INVALID_ARGUMENT" });
      await assert.rejects(resolveService(options as any), { code: "INVALID_ARGUMENT" });
    }
  });

  it("本地项目未登记也能装载，并从注册表补充单动作授权包", async () => {
    const { service } = await resolveService({
      projectRoot: projectA,
      packageAllowlist: ["linked.pkg.x"],
      actionAllowlist: ["linked.pkg.y/read"],
      customHome: registryHome,
    });
    try {
      const ids = (await service.discovery.listActions()).map((action) => action.id);
      assert.ok(ids.includes("linked.pkg.x/op"));
      assert.ok(ids.includes("linked.pkg.y/read"));
    } finally { await service.close(); }
  });

  it("内存主包与额外动作授权在真实适配器中均可用", async () => {
    const server = await createActionDockMcpServer({
      packageId: "mem.pkg",
      actions: new Map([["echo", defineAction({ run: () => ({ echo: true }) })]]),
      packageAllowlist: ["mem.pkg"],
      actionAllowlist: ["linked.pkg.y/read"],
      customHome: registryHome,
    });
    try {
      const request = await connect(server);
      const names = (await request("tools/list")).result.tools.map((tool: any) => tool.name);
      assert.deepEqual(names.sort(), ["echo", "read"]);
    } finally { await server.close(); await server.service.close(); }
  });

  it("全量标记不会抹掉显式包选择的装载目标", async () => {
    const { service } = await resolveService({
      packageIds: ["linked.pkg.y"],
      packageAllowlist: ["*"],
      customHome: registryHome,
    });
    try {
      assert.ok((await service.discovery.listActions()).some((action) => action.packageId === "linked.pkg.y"));
    } finally { await service.close(); }
  });

  it("全量标记不作为真实包查询注册表", async () => {
    const { service } = await resolveService({ projectRoot: projectA, packageAllowlist: ["*"], customHome: registryHome });
    try {
      assert.ok((await service.discovery.listActions()).some((action) => action.packageId === "linked.pkg.x"));
    } finally { await service.close(); }
  });
});
