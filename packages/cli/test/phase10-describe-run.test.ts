import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import {
  StandaloneDispatcher,
  ExitCode,
} from "@actiondock/core/server";
import {
  buildActionDescribePayload,
} from "@actiondock/core/project";
import { executeAction } from "../src/commands/run";
import { main, runStandaloneCli } from "../src/index";
import type { CliContext } from "../src/types";
import { runCliAsync } from "./helpers/run-cli";

describe("Phase 10: CLI Describe / Run 集成与普通 CLI / Standalone 行为对齐", () => {
  let localExecuted = false;
  const sampleAction = defineAction({
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    },
    run(input) {
      localExecuted = true;
      return { hello: (input as any)?.name };
    },
  });

  const baseStandaloneOpts = {
    packageId: "test.phase10",
    version: "1.0.0",
    actions: [{ id: "greet", action: sampleAction }],
    inMemory: true,
    stdout: () => {},
    stderr: () => {},
  };

  describe("describe --json 元数据输出与版本字段对齐", () => {
    it("standalone describe --json 产出统一 Payload 结构且剔除重复全局元数据", async () => {
      let out = "";
      const code = await runStandaloneCli(["describe", "greet", "--json"], {
        ...baseStandaloneOpts,
        stdout: (msg) => (out += msg),
      });

      assert.strictEqual(code, ExitCode.SUCCESS);
      const parsed = JSON.parse(out);

      assert.strictEqual(parsed.id, "greet");
      assert.strictEqual(parsed.packageId, "test.phase10");
      assert.deepStrictEqual(parsed.inputSchema, sampleAction.inputSchema);
      assert.strictEqual(parsed.outputSchema, undefined);

      // 验证重复元数据已被移除
      assert.strictEqual(parsed.inputTransport, undefined);
      assert.strictEqual(parsed.inputEncoding, undefined);
      assert.strictEqual(parsed.inputPolicy, undefined);

      // 验证 inputAdvice 精简结构
      assert.notStrictEqual(parsed.inputAdvice, undefined);
      assert.strictEqual(parsed.inputAdvice.version, 1);
      assert.strictEqual(parsed.inputAdvice.recommendedMode, "flat");
      assert.deepStrictEqual(parsed.inputAdvice.assignments, {
        name: "=",
        age: ":=",
      });

      const expectedPayload = buildActionDescribePayload({
        id: "greet",
        packageId: "test.phase10",
        inputSchema: sampleAction.inputSchema,
      });
      assert.deepStrictEqual(parsed, expectedPayload);
    });

    it("普通 CLI describe --json 与 Standalone describe --json 机器契约完全一致", async () => {
      // 1. standalone describe
      let standaloneOut = "";
      await runStandaloneCli(["describe", "greet", "--json"], {
        ...baseStandaloneOpts,
        stdout: (msg) => (standaloneOut += msg),
      });
      const standaloneData = JSON.parse(standaloneOut);

      // 2. 真实调用普通 CLI: main(["node", "ad", "describe", "greet", "-P", tempPkgDir, "--json"])
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-phase10-cli-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.phase10",
            name: "test.phase10",
            version: "1.0.0",
            actions: {
              greet: {
                inputSchema: sampleAction.inputSchema,
              },
            },
          })
        );
        mkdirSync(join(tempPkgDir, "actions"), { recursive: true });
        writeFileSync(
          join(tempPkgDir, "actions", "greet.ts"),
          "export default function run(input: any) { return { hello: input?.name }; }\n"
        );

        let cliOut = "";
        const origConsoleLog = console.log;
        console.log = (msg: any) => {
          cliOut += String(msg);
        };
        try {
          const exitCode = await main([
            "node",
            "ad",
            "describe",
            "greet",
            "-P",
            tempPkgDir,
            "--json",
          ]);
          assert.strictEqual(exitCode, 0);
        } finally {
          console.log = origConsoleLog;
        }

        const cliData = JSON.parse(cliOut);

        // 3. 直接完整比较普通 CLI 与 Standalone 输出 JSON
        assert.deepStrictEqual(cliData, standaloneData);
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("普通 CLI describe 与 Standalone describe 人类可读文本均包含 Syntax Reference 语法速查", async () => {
      // 1. standalone describe (human-readable)
      let standaloneOut = "";
      const standaloneCode = await runStandaloneCli(["describe", "greet"], {
        ...baseStandaloneOpts,
        stdout: (msg) => (standaloneOut += msg),
      });
      assert.strictEqual(standaloneCode, ExitCode.SUCCESS);
      assert.ok((standaloneOut).includes("Action: greet"));
      assert.ok((standaloneOut).includes("Recommended Input: flat"));
      assert.ok((standaloneOut).includes("Assignments:"));
      assert.ok((standaloneOut).includes("Syntax Reference:"));
      assert.ok((standaloneOut).includes('key="value"'));
      assert.ok((standaloneOut).includes("count:=10  enabled:=true"));
      assert.ok((standaloneOut).includes('tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")'));
      assert.ok((standaloneOut).includes("--input-file input.json"));

      // 2. 真实调用普通 CLI describe (human-readable)
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-phase10-cli-human-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.phase10",
            name: "test.phase10",
            version: "1.0.0",
            actions: {
              greet: {
                inputSchema: sampleAction.inputSchema,
              },
            },
          })
        );
        mkdirSync(join(tempPkgDir, "actions"), { recursive: true });
        writeFileSync(
          join(tempPkgDir, "actions", "greet.ts"),
          "export default function run(input: any) { return { hello: input?.name }; }\n"
        );

        let cliOut = "";
        const origConsoleLog = console.log;
        console.log = (msg: any) => {
          cliOut += String(msg);
        };
        try {
          const exitCode = await main([
            "node",
            "ad",
            "describe",
            "greet",
            "-P",
            tempPkgDir,
          ]);
          assert.strictEqual(exitCode, 0);
        } finally {
          console.log = origConsoleLog;
        }

        assert.ok((cliOut).includes("Action: greet"));
        assert.ok((cliOut).includes("Recommended Input: flat"));
        assert.ok((cliOut).includes("Assignments:"));
        assert.ok((cliOut).includes("Syntax Reference:"));
        assert.ok((cliOut).includes('key="value"'));
        assert.ok((cliOut).includes("count:=10  enabled:=true"));
        assert.ok((cliOut).includes('tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")'));
        assert.ok((cliOut).includes("--input-file input.json"));
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });
  });

  describe("CLI Pre-Target Policy 强制执行（Section 25）", () => {
    it("Standalone handleRun 拦截包含 __proto__ 的输入，杜绝执行 Action", async () => {
      localExecuted = false;
      let out = "";
      const code = await runStandaloneCli(
        ["run", "greet", "--input", '{"__proto__": {"polluted": true}, "name": "Bob"}', "--json"],
        {
          ...baseStandaloneOpts,
          stdout: (msg) => (out += msg),
        }
      );

      assert.strictEqual(code, ExitCode.INVALID_ARGUMENT);
      assert.strictEqual(localExecuted, false);

      const parsed = JSON.parse(out);
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "INPUT_POLICY_VIOLATION");
      assert.strictEqual(parsed.error.details?.reason, "FORBIDDEN_PROPERTY");
      assert.strictEqual(parsed.error.details?.property, "__proto__");
    });

    it("Standalone handleRun 拦截包含 constructor / prototype 的输入", async () => {
      for (const forbiddenKey of ["constructor", "prototype"]) {
        localExecuted = false;
        let out = "";
        const code = await runStandaloneCli(
          ["run", "greet", "--input", JSON.stringify({ [forbiddenKey]: "bad", name: "Alice" }), "--json"],
          {
            ...baseStandaloneOpts,
            stdout: (msg) => (out += msg),
          }
        );

        assert.strictEqual(code, ExitCode.INVALID_ARGUMENT);
        assert.strictEqual(localExecuted, false);

        const parsed = JSON.parse(out);
        assert.strictEqual(parsed.ok, false);
        assert.strictEqual(parsed.error.code, "INPUT_POLICY_VIOLATION");
        assert.strictEqual(parsed.error.details?.reason, "FORBIDDEN_PROPERTY");
        assert.strictEqual(parsed.error.details?.property, forbiddenKey);
      }
    });

    it("executeAction 拦截包含禁止属性的输入，在派发至 target 前抛出 INPUT_POLICY_VIOLATION", async () => {
      let targetCalled = false;
      const context: CliContext = { exitCode: 0 };

      // 无论目标是 local 还是 remote，在 resolveActionInput 之后立刻被本地拦截
      let caughtErr: any;
      try {
        await executeAction(
          "test.greet",
          {
            input: '{"__proto__": {}, "name": "Alice"}',
            target: "http://127.0.0.1:9999", // 故意指定无效的远端地址，若未被本地拦截则会因网络连接报错
          },
          context
        );
        assert.strictEqual(true, false);
      } catch (err) {
        caughtErr = err;
      }

      assert.notStrictEqual(caughtErr, undefined);
      assert.strictEqual(caughtErr?.code, "INPUT_POLICY_VIOLATION");
      assert.strictEqual(caughtErr?.details?.reason, "FORBIDDEN_PROPERTY");
      assert.strictEqual(caughtErr?.details?.property, "__proto__");
      assert.strictEqual(targetCalled, false);
    });

    it("executeAction 拦截包含 constructor / prototype 的输入并在派发至 target 前抛出 INPUT_POLICY_VIOLATION", async () => {
      for (const forbiddenKey of ["constructor", "prototype"]) {
        let caughtErr: any;
        try {
          await executeAction(
            "test.greet",
            {
              input: JSON.stringify({ [forbiddenKey]: "bad", name: "Alice" }),
              target: "http://127.0.0.1:9999", // 故意指定无效的远端地址，若未被本地拦截则会因网络连接报错
            },
            { exitCode: 0 }
          );
          assert.strictEqual(true, false);
        } catch (err) {
          caughtErr = err;
        }

        assert.notStrictEqual(caughtErr, undefined);
        assert.strictEqual(caughtErr?.code, "INPUT_POLICY_VIOLATION");
        assert.strictEqual(caughtErr?.details?.reason, "FORBIDDEN_PROPERTY");
        assert.strictEqual(caughtErr?.details?.property, forbiddenKey);
      }
    });

    it("main 函数对 INPUT_POLICY_VIOLATION 返回退出码 2 并输出标准 JSON 错误信封", async () => {
      let stdoutContent = "";
      const origConsoleLog = console.log;
      console.log = (msg: any) => {
        stdoutContent += String(msg);
      };

      try {
        const exitCode = await main([
          "node",
          "ad",
          "run",
          "sample.greet",
          "--input",
          '{"__proto__": {}}',
          "--json",
        ]);

        assert.strictEqual(exitCode, ExitCode.INVALID_ARGUMENT);
        const parsed = JSON.parse(stdoutContent);
        assert.strictEqual(parsed.ok, false);
        assert.strictEqual(parsed.error.code, "INPUT_POLICY_VIOLATION");
        assert.strictEqual(parsed.error.details?.reason, "FORBIDDEN_PROPERTY");
      } finally {
        console.log = origConsoleLog;
      }
    });
  });

  describe("入参校验失败时引导使用 describe 查看（普通 CLI 与 Standalone 行为一致性）", () => {
    it("Standalone handleRun 在 INPUT_VALIDATION_FAILED 时向 stderr 输出 Tip 引导", async () => {
      let stderrOut = "";
      let stdoutOut = "";
      const code = await runStandaloneCli(["run", "greet", "--input", '{"age": 20}'], {
        ...baseStandaloneOpts,
        stdout: (msg) => (stdoutOut += msg),
        stderr: (msg) => (stderrOut += msg),
      });

      assert.strictEqual(code, ExitCode.FAILURE);
      assert.strictEqual(stdoutOut.trim(), "");
      assert.ok((stderrOut).includes("Error [INPUT_VALIDATION_FAILED]"));
      assert.ok((stderrOut).includes("Tip: Run 'ad describe greet' to inspect schema and syntax examples."));
    });

    it("Standalone handleRun 在 --json 模式下 INPUT_VALIDATION_FAILED 严禁输出 Tip 且保持机器输出", async () => {
      let stderrOut = "";
      let stdoutOut = "";
      const code = await runStandaloneCli(["run", "greet", "--input", '{"age": 20}', "--json"], {
        ...baseStandaloneOpts,
        stdout: (msg) => (stdoutOut += msg),
        stderr: (msg) => (stderrOut += msg),
      });

      assert.strictEqual(code, ExitCode.FAILURE);
      assert.strictEqual(stderrOut.trim(), "");
      const parsed = JSON.parse(stdoutOut);
      assert.strictEqual(parsed.ok, false);
      assert.strictEqual(parsed.error.code, "INPUT_VALIDATION_FAILED");
    });

    it("Standalone handleRun 在非 INPUT_VALIDATION_FAILED 错误（如 ACTION_FAILED）时严禁输出 Tip", async () => {
      const failingAction = defineAction({
        run() {
          throw new Error("Custom boom");
        },
      });
      let stderrOut = "";
      let stdoutOut = "";
      const code = await runStandaloneCli(["run", "boom", "--input", "{}"], {
        packageId: "test.phase10",
        version: "1.0.0",
        actions: [{ id: "boom", action: failingAction }],
        inMemory: true,
        stdout: (msg) => (stdoutOut += msg),
        stderr: (msg) => (stderrOut += msg),
      });

      assert.strictEqual(code, ExitCode.FAILURE);
      assert.ok((stderrOut).includes("Error [ACTION_FAILED]"));
      assert.ok(!(stderrOut).includes("Tip: Run 'ad describe"));
    });

    it("普通 CLI 与 Standalone 在入参校验失败时均输出 Tip 引导并保持一致", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-phase10-val-cli-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.phase10",
            name: "test.phase10",
            version: "1.0.0",
            actions: {
              greet: {
                entry: "actions/greet.ts",
                inputSchema: sampleAction.inputSchema,
              },
            },
          })
        );
        mkdirSync(join(tempPkgDir, "actions"), { recursive: true });
        writeFileSync(
          join(tempPkgDir, "actions", "greet.ts"),
          "export default function run(input: any) { return { hello: input?.name }; }\n"
        );

        const proc = await runCliAsync(
          ["run", "greet", "--input", '{"age": 30}'],
          tempPkgDir
        );

        assert.strictEqual(proc.exitCode, 1);
        assert.strictEqual(proc.stdout.toString().trim(), "");
        const stderr = proc.stderr.toString();
        assert.ok((stderr).includes("Error [INPUT_VALIDATION_FAILED]"));
        assert.ok((stderr).includes("Tip: Run 'ad describe greet' to inspect schema and syntax examples."));
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("普通 CLI 在 --json 模式下入参校验失败严禁输出 Tip 引导", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-phase10-val-json-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.phase10",
            name: "test.phase10",
            version: "1.0.0",
            actions: {
              greet: {
                entry: "actions/greet.ts",
                inputSchema: sampleAction.inputSchema,
              },
            },
          })
        );
        mkdirSync(join(tempPkgDir, "actions"), { recursive: true });
        writeFileSync(
          join(tempPkgDir, "actions", "greet.ts"),
          "export default function run(input: any) { return { hello: input?.name }; }\n"
        );

        const proc = await runCliAsync(
          ["run", "greet", "--input", '{"age": 30}', "--json"],
          tempPkgDir
        );

        assert.strictEqual(proc.exitCode, 1);
        assert.strictEqual(proc.stderr.toString().trim(), "");
        const parsed = JSON.parse(proc.stdout.toString());
        assert.strictEqual(parsed.ok, false);
        assert.strictEqual(parsed.error.code, "INPUT_VALIDATION_FAILED");
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });
  });
});
