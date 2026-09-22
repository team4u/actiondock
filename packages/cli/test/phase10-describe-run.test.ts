import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import {
  StandaloneDispatcher,
  ExitCode,
  buildActionDescribePayload,
} from "@actiondock/core";
import { executeAction } from "../src/commands/run";
import { main } from "../src/index";
import { runStandaloneCli } from "../src/standalone";
import type { CliContext } from "../src/types";

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

      expect(code).toBe(ExitCode.SUCCESS);
      const parsed = JSON.parse(out);

      expect(parsed.id).toBe("greet");
      expect(parsed.packageId).toBe("test.phase10");
      expect(parsed.inputSchema).toEqual(sampleAction.inputSchema);
      expect(parsed.outputSchema).toBeUndefined();

      // 验证重复元数据已被移除
      expect(parsed.inputTransport).toBeUndefined();
      expect(parsed.inputEncoding).toBeUndefined();
      expect(parsed.inputPolicy).toBeUndefined();

      // 验证 inputAdvice 精简结构
      expect(parsed.inputAdvice).toBeDefined();
      expect(parsed.inputAdvice.version).toBe(1);
      expect(parsed.inputAdvice.recommendedMode).toBe("flat");
      expect(parsed.inputAdvice.assignments).toEqual({
        name: "=",
        age: ":=",
      });

      const expectedPayload = buildActionDescribePayload({
        id: "greet",
        packageId: "test.phase10",
        inputSchema: sampleAction.inputSchema,
      });
      expect(parsed).toEqual(expectedPayload);
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
          expect(exitCode).toBe(0);
        } finally {
          console.log = origConsoleLog;
        }

        const cliData = JSON.parse(cliOut);

        // 3. 直接完整比较普通 CLI 与 Standalone 输出 JSON
        expect(cliData).toEqual(standaloneData);
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

      expect(code).toBe(ExitCode.INVALID_ARGUMENT);
      expect(localExecuted).toBe(false);

      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe("INPUT_POLICY_VIOLATION");
      expect(parsed.error.details?.reason).toBe("FORBIDDEN_PROPERTY");
      expect(parsed.error.details?.property).toBe("__proto__");
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

        expect(code).toBe(ExitCode.INVALID_ARGUMENT);
        expect(localExecuted).toBe(false);

        const parsed = JSON.parse(out);
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe("INPUT_POLICY_VIOLATION");
        expect(parsed.error.details?.reason).toBe("FORBIDDEN_PROPERTY");
        expect(parsed.error.details?.property).toBe(forbiddenKey);
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
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr?.code).toBe("INPUT_POLICY_VIOLATION");
      expect(caughtErr?.details?.reason).toBe("FORBIDDEN_PROPERTY");
      expect(caughtErr?.details?.property).toBe("__proto__");
      expect(targetCalled).toBe(false);
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
        } catch (err) {
          caughtErr = err;
        }

        expect(caughtErr).toBeDefined();
        expect(caughtErr?.code).toBe("INPUT_POLICY_VIOLATION");
        expect(caughtErr?.details?.reason).toBe("FORBIDDEN_PROPERTY");
        expect(caughtErr?.details?.property).toBe(forbiddenKey);
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

        expect(exitCode).toBe(ExitCode.INVALID_ARGUMENT);
        const parsed = JSON.parse(stdoutContent);
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe("INPUT_POLICY_VIOLATION");
        expect(parsed.error.details?.reason).toBe("FORBIDDEN_PROPERTY");
      } finally {
        console.log = origConsoleLog;
      }
    });
  });
});
