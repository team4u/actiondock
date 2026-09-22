import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import {
  StandaloneDispatcher,
  ExitCode,
  buildCliDescribeInputMetadataV1,
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
    it("standalone describe --json 注入完整输入元数据且 scope 为 cli-pre-target", async () => {
      let out = "";
      const code = await runStandaloneCli(["describe", "greet", "--json"], {
        ...baseStandaloneOpts,
        stdout: (msg) => (out += msg),
      });

      expect(code).toBe(ExitCode.SUCCESS);
      const parsed = JSON.parse(out);

      expect(parsed.id).toBe("greet");
      expect(parsed.inputTransport).toBeDefined();
      expect(parsed.inputTransport.version).toBe(1);
      expect(parsed.inputTransport.fullJson.inlineOption).toBe("--input");
      expect(parsed.inputTransport.fullJson.fileOption).toBe("--input-file");

      expect(parsed.inputEncoding).toBeDefined();
      expect(parsed.inputEncoding.name).toBe("flat-json-value");
      expect(parsed.inputEncoding.version).toBe(1);
      expect(parsed.inputEncoding.operators.string).toBe("=");
      expect(parsed.inputEncoding.operators.json).toBe(":=");

      expect(parsed.inputPolicy).toBeDefined();
      expect(parsed.inputPolicy.version).toBe(1);
      expect(parsed.inputPolicy.scope).toBe("cli-pre-target");
      expect(parsed.inputPolicy.forbiddenPropertyNames).toContain("__proto__");
      expect(parsed.inputPolicy.forbiddenPropertyNames).toContain("constructor");
      expect(parsed.inputPolicy.forbiddenPropertyNames).toContain("prototype");

      expect(parsed.inputAdvice).toBeDefined();
      expect(parsed.inputAdvice.version).toBe(1);
      expect(parsed.inputAdvice.schemaState).toBe("object");
      expect(parsed.inputAdvice.schemaRecommendedMode).toBe("flat");
      expect(parsed.inputAdvice.flatCandidate).toBe(true);
      expect(parsed.inputAdvice.requiredSatisfiable).toBe(true);

      const expectedMetadata = buildCliDescribeInputMetadataV1(sampleAction.inputSchema);
      expect(parsed.inputTransport).toEqual(expectedMetadata.inputTransport);
      expect(parsed.inputEncoding).toEqual(expectedMetadata.inputEncoding);
      expect(parsed.inputPolicy).toEqual(expectedMetadata.inputPolicy);
      expect(parsed.inputAdvice).toEqual(expectedMetadata.inputAdvice);
    });

    it("普通 CLI describe --json 与 Standalone describe --json 机器契约完全一致", async () => {
      // 1. standalone describe
      let standaloneOut = "";
      await runStandaloneCli(["describe", "greet", "--json"], {
        ...baseStandaloneOpts,
        stdout: (msg) => (standaloneOut += msg),
      });
      const standaloneData = JSON.parse(standaloneOut);

      // 2. buildCliDescribeInputMetadataV1 构造结果比对
      const directMetadata = buildCliDescribeInputMetadataV1(sampleAction.inputSchema);

      expect(standaloneData.inputTransport).toEqual(directMetadata.inputTransport);
      expect(standaloneData.inputEncoding).toEqual(directMetadata.inputEncoding);
      expect(standaloneData.inputPolicy).toEqual(directMetadata.inputPolicy);
      expect(standaloneData.inputAdvice).toEqual(directMetadata.inputAdvice);
      expect(standaloneData.inputPolicy.scope).toBe("cli-pre-target");
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
