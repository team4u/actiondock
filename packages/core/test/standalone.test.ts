import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction } from "@actiondock/sdk";
import { StandaloneDispatcher } from "../src/runtime/standalone";

describe("StandaloneDispatcher 独立二进制运行时委托 PackageRuntime", () => {
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

  const runtime = new StandaloneDispatcher({
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
      await runtime.dispatch(["list", `--data-dir=${tmpDir}`]);
      assert.strictEqual(logs.some((l) => l.includes("Actions in pkg.standalone (v1.2.3):")), true);
      assert.strictEqual(logs.some((l) => l.includes("greet") && l.includes("打招呼动作")), true);

      // JSON 输出
      logs.length = 0;
      await runtime.dispatch(["list", "--json", `--data-dir=${tmpDir}`]);
      const parsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(Array.isArray(parsed.items), true);
      assert.strictEqual(parsed.items.some((item: any) => item.id === "greet"), true);
      assert.deepStrictEqual(parsed.hints, [
        "Tip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures.",
      ]);
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
      await runtime.dispatch(["describe", "greet", `--data-dir=${tmpDir}`]);
      assert.strictEqual(logs.some((l) => l.includes("Action: greet")), true);

      // JSON 输出
      logs.length = 0;
      await runtime.dispatch(["show", "greet", "--json", `--data-dir=${tmpDir}`]);
      const parsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(parsed.id, "greet");
      assert.strictEqual(parsed.description, "打招呼动作");
      assert.notStrictEqual(parsed.inputSchema, undefined);
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
      await runtime.dispatch([
        "run",
        "greet",
        '--input={"name":"Alice"}',
        `--data-dir=${tmpDir}`,
      ]);
      assert.ok((logs.join("\n")).includes("Hello, Alice!"));

      // 2. --json 机器信封输出
      logs.length = 0;
      await runtime.dispatch([
        "run",
        "greet",
        '--input={"name":"Alice"}',
        "--json",
        `--data-dir=${tmpDir}`,
      ]);
      const parsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(parsed.ok, true);
      assert.deepStrictEqual(parsed.data, { greeting: "Hello, Alice!" });
      assert.notStrictEqual(parsed.runId, undefined);
    } finally {
      console.log = origLog;
    }
  });

  it("支持 --stdin-field 将 stdin 原文绑定为入参字段并可与扁平参数组合", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "echo",
          action: defineAction({
            run(input: { text: string; style?: string }) {
              return { received: input };
            },
          }),
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string" },
              style: { type: "string" },
            },
            required: ["text"],
          },
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    const origStdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      configurable: true,
      get: () => Readable.from(["这是一段正文"]),
    });
    try {
      const code = await dispatcher.dispatch([
        "run",
        "echo",
        "--stdin-field",
        "text",
        "--json",
        `--data-dir=${tmpDir}`,
        "--",
        "style=brief",
      ]);
      assert.strictEqual(code, 0);
      const parsed = JSON.parse(stdoutLogs.join("\n"));
      assert.strictEqual(parsed.ok, true);
      assert.deepStrictEqual(parsed.data.received, {
        text: "这是一段正文",
        style: "brief",
      });
    } finally {
      if (origStdinDescriptor) {
        Object.defineProperty(process, "stdin", origStdinDescriptor);
      }
    }
  });

  it("目录型入口拒绝 --stdin-field 与 --input 或 --input-file 混用并返回退出码 2", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "echo",
          action: defineAction({
            run(input: { text: string }) {
              return { received: input };
            },
          }),
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    const origStdinDescriptor2 = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      configurable: true,
      get: () => Readable.from(["x"]),
    });
    try {
      const code = await dispatcher.dispatch([
        "run",
        "echo",
        "--stdin-field",
        "text",
        '--input={"a":1}',
        "--json",
        `--data-dir=${tmpDir}`,
      ]);
      assert.strictEqual(code, 2);
      const parsed = JSON.parse(stdoutLogs.join("\n"));
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "INPUT_CONFLICT");
    } finally {
      if (origStdinDescriptor2) {
        Object.defineProperty(process, "stdin", origStdinDescriptor2);
      }
    }
  });

  it("支持 config 子命令完成 set, get, list, delete 闭环", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // set
      await runtime.dispatch(["config", "set", "theme", '"dark"', `--data-dir=${tmpDir}`]);
      assert.strictEqual(logs.some((l) => l.includes("Config 'theme' updated")), true);

      // get
      logs.length = 0;
      await runtime.dispatch(["config", "get", "theme", `--data-dir=${tmpDir}`]);
      assert.strictEqual(logs.some((l) => l.includes('"dark"')), true);

      // list
      logs.length = 0;
      await runtime.dispatch(["config", "list", `--data-dir=${tmpDir}`]);
      const listParsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(listParsed.theme, "dark");

      // delete
      logs.length = 0;
      await runtime.dispatch(["config", "delete", "theme", `--data-dir=${tmpDir}`]);
      assert.strictEqual(logs.some((l) => l.includes("Config 'theme' deleted")), true);
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
      await runtime.dispatch([
        "state",
        "set",
        "count",
        "42",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      assert.strictEqual(logs.some((l) => l.includes("State 'session:count' updated")), true);

      // get
      logs.length = 0;
      await runtime.dispatch([
        "state",
        "get",
        "count",
        "--namespace=session",
        "--json",
        `--data-dir=${tmpDir}`,
      ]);
      const getParsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(getParsed.key, "count");
      assert.strictEqual(getParsed.value, 42);

      // list
      logs.length = 0;
      await runtime.dispatch([
        "state",
        "list",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      const listParsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(Array.isArray(listParsed), true);
      assert.ok((listParsed).includes("count"));

      // delete
      logs.length = 0;
      await runtime.dispatch([
        "state",
        "delete",
        "count",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      assert.strictEqual(logs.some((l) => l.includes("State 'count' deleted")), true);

      // clear
      logs.length = 0;
      await runtime.dispatch([
        "state",
        "clear",
        "--namespace=session",
        `--data-dir=${tmpDir}`,
      ]);
      assert.strictEqual(logs.some((l) => l.includes("Cleared 0 state entry(s)")), true);
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
    assert.strictEqual(code1, 0);
    assert.ok((stdoutLogs.join("\n")).includes("Hello, Bob!"));

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
    assert.strictEqual(code2, 0);
    const parsed = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(parsed.ok, true);
    assert.deepStrictEqual(parsed.data, { greeting: "Hello, Charlie!" });
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
    assert.strictEqual(code, 0);
    const parsed = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(parsed.ok, true);
    assert.deepStrictEqual(parsed.data, { greeting: "Hello, --data-dir=fake!" });
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
    assert.strictEqual(code1, 2);
    assert.ok((stdoutLogs.length) > 0);
    const err1 = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(err1.ok, false);
    assert.strictEqual(err1.error.code, "INVALID_JSON_LITERAL");
    assert.notStrictEqual(err1.error.message, undefined);

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
    assert.strictEqual(code2, 2);
    const err2 = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(err2.ok, false);
    assert.strictEqual(err2.error.code, "INPUT_CONFLICT");

    // 3. 缺少 Action ID
    stdoutLogs.length = 0;
    const code3 = await dispatcher.dispatch([
      "run",
      "--json",
      `--data-dir=${tmpDir}`,
    ]);
    assert.strictEqual(code3, 2);
    const err3 = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(err3.ok, false);
    assert.strictEqual(err3.error.code, "INVALID_ARGUMENT");
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
    assert.strictEqual(code, 2);
    assert.strictEqual(stderrLogs.some((l) => l.includes("Error:")), true);
    assert.strictEqual(stdoutLogs.length, 0);
  });

  it("在入参校验失败时仅向 stderr 追加 describe 引导 Tip", async () => {
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

    const code = await dispatcher.dispatch([
      "run",
      "greet",
      '--input={"age":25}',
      `--data-dir=${tmpDir}`,
    ]);
    assert.strictEqual(code, 1);
    assert.strictEqual(stdoutLogs.length, 0);
    assert.strictEqual(stderrLogs.some((l) => l.includes("Error [INPUT_VALIDATION_FAILED]")), true);
    assert.strictEqual(stderrLogs.some((l) => l.includes("Tip: Run 'ad describe greet' to inspect schema and syntax examples.")), true);

    // --json 模式向标准输出写入包含根节点 hint 的机器信封，且 stderr 保持纯净
    stdoutLogs.length = 0;
    stderrLogs.length = 0;
    const jsonCode = await dispatcher.dispatch([
      "run",
      "greet",
      '--input={"age":25}',
      "--json",
      `--data-dir=${tmpDir}`,
    ]);
    assert.strictEqual(jsonCode, 1);
    assert.strictEqual(stderrLogs.length, 0);
    const parsed = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "INPUT_VALIDATION_FAILED");
    assert.strictEqual(parsed.hint, "Tip: Run 'ad describe greet' to inspect schema and syntax examples.");
  });

  it("在非 INPUT_VALIDATION_FAILED 错误（如 ACTION_FAILED）时严禁输出 describe 引导 Tip", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "fail",
          action: failAction,
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    const code = await dispatcher.dispatch([
      "run",
      "fail",
      `--data-dir=${tmpDir}`,
    ]);
    assert.strictEqual(code, 1);
    assert.strictEqual(stderrLogs.some((l) => l.includes("Error [ACTION_FAILED]")), true);
    assert.strictEqual(stderrLogs.some((l) => l.includes("Tip: Run 'ad describe")), false);

    // --json 模式下同样无 hint 字段
    stdoutLogs.length = 0;
    stderrLogs.length = 0;
    const jsonCode = await dispatcher.dispatch([
      "run",
      "fail",
      "--json",
      `--data-dir=${tmpDir}`,
    ]);
    assert.strictEqual(jsonCode, 1);
    assert.strictEqual(stderrLogs.length, 0);
    const parsed = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "ACTION_FAILED");
    assert.strictEqual(parsed.hint, undefined);
  });

  it("在 ACTION_NOT_FOUND 时在 --json 模式下向根节点写入发现提示", async () => {
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

    const jsonCode = await dispatcher.dispatch([
      "run",
      "nonexistent",
      "--json",
      `--data-dir=${tmpDir}`,
    ]);
    assert.strictEqual(jsonCode, 1);
    assert.strictEqual(stderrLogs.length, 0);
    const parsed = JSON.parse(stdoutLogs.join("\n"));
    assert.strictEqual(parsed.ok, false);
    assert.strictEqual(parsed.error.code, "ACTION_NOT_FOUND");
    assert.strictEqual(parsed.hint, "Tip: Run 'ad list' to discover available actions, or 'ad info' to inspect packages.");
  });

  it("目录型 Standalone 运行时的 describe 输出说明与真实执行行为完全对照一致", async () => {
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];

    const fileReaderAction = defineAction({
      run() {
        return {
          content: "file content text",
          path: "sample.txt",
          line: 12,
        };
      },
    });

    const annotatedAction = defineAction({
      run() {
        return {
          content: "sniffed content",
          customField: "custom text",
          extra: "meta",
        };
      },
    });

    const plainObjectAction = defineAction({
      run() {
        return {
          key: "value",
          count: 99,
        };
      },
    });

    const dispatcher = new StandaloneDispatcher({
      packageId: "pkg.standalone",
      version: "1.2.3",
      actions: [
        {
          id: "read-file",
          action: fileReaderAction,
          description: "文件读取动作",
        },
        {
          id: "annotated",
          action: annotatedAction,
          description: "带注解动作",
          annotations: {
            "actiondock.cli": { textField: "customField" },
          },
        },
        {
          id: "plain-object",
          action: plainObjectAction,
          description: "普通对象动作",
        },
      ],
      stdout: (msg) => stdoutLogs.push(msg),
      stderr: (msg) => stderrLogs.push(msg),
    });

    // 1. 验证未注解动作的 describe 文案与实际 run 执行输出一致
    await dispatcher.dispatch(["describe", "read-file", `--data-dir=${tmpDir}`]);
    const describeText = stdoutLogs.join("\n");
    assert.ok(describeText.includes("extracts 'content', 'text', or 'message' from objects (with metadata on stderr), falling back to formatted JSON"));
    assert.ok(!describeText.includes("--text-field"));

    stdoutLogs.length = 0;
    stderrLogs.length = 0;
    const runCode1 = await dispatcher.dispatch(["run", "read-file", `--data-dir=${tmpDir}`]);
    assert.strictEqual(runCode1, 0);
    // stdout 提取出 content 字段正文
    assert.strictEqual(stdoutLogs.join("").trim(), "file content text");
    // stderr 打印剩余元数据标签
    assert.ok(stderrLogs.some((l) => l.includes("sample.txt") && l.includes("line 12")));

    // 2. 验证带注解动作：describe 明确标注 standalone 忽略 textField 并嗅探，实际 run 确实嗅探 content 而非 customField
    stdoutLogs.length = 0;
    stderrLogs.length = 0;
    await dispatcher.dispatch(["describe", "annotated", `--data-dir=${tmpDir}`]);
    const annotatedDescribe = stdoutLogs.join("\n");
    assert.ok(annotatedDescribe.includes("Default text field: customField (note: ignored in standalone runtime; standalone extracts 'content', 'text', or 'message', falling back to formatted JSON)"));
    assert.ok(annotatedDescribe.includes("stdout: Raw string for scalars; extracts 'content', 'text', or 'message' from objects"));
    assert.ok(annotatedDescribe.includes("stderr: Remaining fields as metadata (for extracted fields), diagnostics, and logs"));

    stdoutLogs.length = 0;
    stderrLogs.length = 0;
    const runCode2 = await dispatcher.dispatch(["run", "annotated", `--data-dir=${tmpDir}`]);
    assert.strictEqual(runCode2, 0);
    // 实际执行确实输出 content，忽略 customField
    assert.strictEqual(stdoutLogs.join("").trim(), "sniffed content");

    // 3. 验证无嗅探命中对象：回退至 formatted JSON
    stdoutLogs.length = 0;
    stderrLogs.length = 0;
    const runCode3 = await dispatcher.dispatch(["run", "plain-object", `--data-dir=${tmpDir}`]);
    assert.strictEqual(runCode3, 0);
    const parsedObj = JSON.parse(stdoutLogs.join(""));
    assert.deepStrictEqual(parsedObj, { key: "value", count: 99 });
  });
});
