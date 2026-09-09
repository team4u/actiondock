import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction } from "@actiondock/sdk";
import { StandaloneRuntime } from "../src/runtime/standalone";

describe("StandaloneRuntime 独立二进制运行时委托 ActionDockApp", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "standalone-test-"));

  const greetAction = defineAction({
    id: "greet",
    description: "打招呼动作",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    outputSchema: {
      type: "object",
      properties: { greeting: { type: "string" } },
    },
    run(input: { name: string }) {
      return { greeting: `Hello, ${input.name}!` };
    },
  });

  const failAction = defineAction({
    id: "fail",
    description: "失败动作",
    run() {
      throw new Error("Deliberate failure");
    },
  });

  const runtime = new StandaloneRuntime({
    packageId: "pkg.standalone",
    version: "1.2.3",
    description: "测试用独立二进制运行时包",
    actions: [greetAction, failAction],
  });

  it("支持 list 子命令输出 Action 列表文本与 JSON 格式", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // 文本输出
      await runtime.run(["list", `--data-dir=${tmpDir}`]);
      expect(logs.some((l) => l.includes("Actions in pkg.standalone (v1.2.3):"))).toBe(true);
      expect(logs.some((l) => l.includes("greet") && l.includes("打招呼动作"))).toBe(true);

      // JSON 输出
      logs.length = 0;
      await runtime.run(["list", "--json", `--data-dir=${tmpDir}`]);
      const parsed = JSON.parse(logs.join("\n"));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((item: any) => item.id === "greet")).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("支持 describe 与 show 子命令输出模式结构", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // 文本输出
      await runtime.run(["describe", "greet", `--data-dir=${tmpDir}`]);
      expect(logs.some((l) => l.includes("Action: greet"))).toBe(true);

      // JSON 输出
      logs.length = 0;
      await runtime.run(["show", "greet", "--json", `--data-dir=${tmpDir}`]);
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.id).toBe("greet");
      expect(parsed.description).toBe("打招呼动作");
      expect(parsed.inputSchema).toBeDefined();
    } finally {
      console.log = origLog;
    }
  });

  it("支持 run 子命令执行 Action 并输出结果信封", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await runtime.run([
        "run",
        "greet",
        '--input={"name":"Alice"}',
        `--data-dir=${tmpDir}`,
      ]);
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toEqual({ greeting: "Hello, Alice!" });
      expect(parsed.runId).toBeDefined();
    } finally {
      console.log = origLog;
    }
  });

  it("支持 config 子命令完成 set, get, list, delete 闭环", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // set
      await runtime.run(["config", "set", "theme", '"dark"', `--data-dir=${tmpDir}`]);
      expect(logs.some((l) => l.includes("Config 'theme' updated"))).toBe(true);

      // get
      logs.length = 0;
      await runtime.run(["config", "get", "theme", `--data-dir=${tmpDir}`]);
      expect(logs.some((l) => l.includes('"dark"'))).toBe(true);

      // list
      logs.length = 0;
      await runtime.run(["config", "list", `--data-dir=${tmpDir}`]);
      const listParsed = JSON.parse(logs.join("\n"));
      expect(listParsed.theme).toBe("dark");

      // delete
      logs.length = 0;
      await runtime.run(["config", "delete", "theme", `--data-dir=${tmpDir}`]);
      expect(logs.some((l) => l.includes("Config 'theme' deleted"))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("支持 state 子命令完成 set, get, list, delete, clear 闭环", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // set
      await runtime.run([
        "state",
        "set",
        "count",
        "42",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      expect(logs.some((l) => l.includes("State 'session:count' updated"))).toBe(true);

      // get
      logs.length = 0;
      await runtime.run([
        "state",
        "get",
        "count",
        "--namespace=session",
        "--json",
        `--data-dir=${tmpDir}`,
      ]);
      const getParsed = JSON.parse(logs.join("\n"));
      expect(getParsed.key).toBe("count");
      expect(getParsed.value).toBe(42);

      // list
      logs.length = 0;
      await runtime.run([
        "state",
        "list",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      const listParsed = JSON.parse(logs.join("\n"));
      expect(Array.isArray(listParsed)).toBe(true);
      expect(listParsed).toContain("count");

      // delete
      logs.length = 0;
      await runtime.run([
        "state",
        "delete",
        "count",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      expect(logs.some((l) => l.includes("State 'count' deleted"))).toBe(true);

      // clear
      logs.length = 0;
      await runtime.run([
        "state",
        "clear",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      expect(logs.some((l) => l.includes("Cleared 0 state entry(s)"))).toBe(true);
    } finally {
      console.log = origLog;
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
