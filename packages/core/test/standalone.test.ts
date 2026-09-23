import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction } from "@actiondock/sdk";
import { StandaloneDispatcher, StandaloneRuntime } from "../src/runtime/standalone";

describe("StandaloneRuntime 独立二进制运行时委托 PackageRuntime", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "standalone-test-"));

  const greetAction = defineAction({
    run(input: { name: string }) {
      return { greeting: `Hello, ${input.name}!` };
    },
  });

  const failAction = defineAction({
    run() {
      throw new Error("Deliberate failure");
    },
  });

  const runtime = new StandaloneRuntime({
    packageId: "pkg.standalone",
    version: "1.2.3",
    description: "测试用独立二进制运行时包",
    actions: [
      {
        id: "greet",
        action: greetAction,
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
      },
      {
        id: "fail",
        action: failAction,
        description: "失败动作",
      },
    ],
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
      // 1. 默认原始纯文本输出
      await runtime.run([
        "run",
        "greet",
        '--input={"name":"Alice"}',
        `--data-dir=${tmpDir}`,
      ]);
      expect(logs.join("\n")).toContain("Hello, Alice!");

      // 2. --json 机器信封输出
      logs.length = 0;
      await runtime.run([
        "run",
        "greet",
        '--input={"name":"Alice"}',
        "--json",
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

  it("支持使用 -- 传递 Flat 扁平参数执行 Action 并成功返回", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "greet",
          action: greetAction,
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    // 1. 默认纯文本输出
    const code1 = await dispatcher.dispatch([
      "run",
      "greet",
      `--data-dir=${tmpDir}`,
      "--",
      "name=Bob",
    ]);
    expect(code1).toBe(0);
    expect(stdoutLogs.join("\n")).toContain("Hello, Bob!");

    // 2. --json 模式输出标准 JSON
    stdoutLogs.length = 0;
    const code2 = await dispatcher.dispatch([
      "run",
      "greet",
      "--json",
      `--data-dir=${tmpDir}`,
      "--",
      "name=Charlie",
    ]);
    expect(code2).toBe(0);
    const parsed = JSON.parse(stdoutLogs.join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ greeting: "Hello, Charlie!" });
  });

  it("确保 -- 后的参数严禁作为控制选项解析", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "greet",
          action: greetAction,
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    // -- 后面的 --data-dir 应该作为普通字符串参数而不是全局配置
    const code = await dispatcher.dispatch([
      "run",
      "greet",
      `--data-dir=${tmpDir}`,
      "--json",
      "--",
      "name=--data-dir=fake",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutLogs.join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ greeting: "Hello, --data-dir=fake!" });
  });

  it("当指定 --json 时，参数解析异常以标准 JSON 格式输出至 stdout 并返回退出码 2", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "greet",
          action: greetAction,
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    // 1. 无效 Flat 参数（非法 JSON）
    const code1 = await dispatcher.dispatch([
      "run",
      "greet",
      "--json",
      `--data-dir=${tmpDir}`,
      "--",
      "bad:=invalid_json",
    ]);
    expect(code1).toBe(2);
    expect(stdoutLogs.length).toBeGreaterThan(0);
    const err1 = JSON.parse(stdoutLogs.join("\n"));
    expect(err1.ok).toBe(false);
    expect(err1.error.code).toBe("INVALID_JSON_LITERAL");
    expect(err1.error.message).toBeDefined();

    // 2. 输入源冲突（--input 与 -- 同时指定）
    stdoutLogs.length = 0;
    const code2 = await dispatcher.dispatch([
      "run",
      "greet",
      '--input={"name":"Alice"}',
      "--json",
      `--data-dir=${tmpDir}`,
      "--",
      "name=Bob",
    ]);
    expect(code2).toBe(2);
    const err2 = JSON.parse(stdoutLogs.join("\n"));
    expect(err2.ok).toBe(false);
    expect(err2.error.code).toBe("INPUT_CONFLICT");

    // 3. 缺少 Action ID
    stdoutLogs.length = 0;
    const code3 = await dispatcher.dispatch([
      "run",
      "--json",
      `--data-dir=${tmpDir}`,
    ]);
    expect(code3).toBe(2);
    const err3 = JSON.parse(stdoutLogs.join("\n"));
    expect(err3.ok).toBe(false);
    expect(err3.error.code).toBe("INVALID_ARGUMENT");
  });

  it("非 --json 模式下参数解析异常输出至 stderr 并返回退出码 2", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "greet",
          action: greetAction,
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    const code = await dispatcher.dispatch([
      "run",
      "greet",
      `--data-dir=${tmpDir}`,
      "--",
      "bad:=invalid_json",
    ]);
    expect(code).toBe(2);
    expect(stderrLogs.some((l) => l.includes("Error:"))).toBe(true);
    expect(stdoutLogs.length).toBe(0);
  });
});
