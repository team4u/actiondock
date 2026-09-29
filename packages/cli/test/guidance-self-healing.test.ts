import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAction } from "@actiondock/sdk";
import {
  describeActionLoadFailure,
  createErrorEnvelope,
} from "@actiondock/core";
import { resolveActionInput } from "@actiondock/core/project";
import { UndeclaredActionDependencyError } from "@actiondock/core/graph";
import { StandaloneDispatcher, ExitCode } from "@actiondock/core/server";
import { main } from "../src/index";
import { runCliAsync } from "./helpers/run-cli";

describe("ActionDock CLI 全自提示与零文档依赖增强体系", () => {
  describe("第一阶段：执行与高频传参自愈 + 确定性缺陷修复", () => {
    it("describeActionLoadFailure 在缺失依赖时输出规范自愈提示", () => {
      const failure = describeActionLoadFailure(new Error("Cannot find module 'foo'"), {
        actionId: "test-act",
        packageId: "test-pkg",
        projectRoot: "/workspace/my-pkg",
      });

      expect(failure.details.hint).toBe(
        "项目依赖缺失，请在 '/workspace/my-pkg' 目录下运行 'npm install --omit=dev' 安装依赖后再试。"
      );
    });

    it("resolveActionInput 在多输入模式冲突时给出清晰单选引导", async () => {
      let err: any;
      try {
        await resolveActionInput({
          input: '{"a": 1}',
          inputFile: "some-file.json",
        });
      } catch (e) {
        err = e;
      }

      expect(err).toBeDefined();
      expect(err.code).toBe("INPUT_CONFLICT");
      expect(err.message).toBe(
        "Input options conflict: flat arguments (-- key=val), inline JSON (-i/--input), and file (-f/--input-file) are mutually exclusive. Specify only one input mode."
      );
    });

    it("CLI 未加 -- 分隔符导致入参被当作未知选项时输出清晰分隔符提示", async () => {
      let stderr = "";
      let stdout = "";
      const exitCode = await main(["node", "ad", "run", "test-act", "--unknownField=123"], undefined, {
        stderr: (msg) => (stderr += msg + "\n"),
        stdout: (msg) => (stdout += msg + "\n"),
      });

      expect(exitCode).toBe(ExitCode.INVALID_ARGUMENT);
      expect(stderr).toContain("Hint: Separate action inputs from CLI options using '--', e.g.: ad run <id> [options] -- <param>=<val> or <param>:=<json>.");
    });

    it("CLI 在 --json 模式下未知选项保持纯净 JSON 信封并携带 hint", async () => {
      let stderr = "";
      let stdout = "";
      const exitCode = await main(["node", "ad", "run", "test-act", "--unknownField=123", "--json"], undefined, {
        stderr: (msg) => (stderr += msg + "\n"),
        stdout: (msg) => (stdout += msg + "\n"),
      });

      expect(exitCode).toBe(ExitCode.INVALID_ARGUMENT);
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
      expect(parsed.hint).toContain("Separate action inputs from CLI options using '--'");
    });

    it("Standalone handleRun 在未知选项时输出清晰分隔符提示并在 --json 时注入 hint", async () => {
      let stderr = "";
      let stdout = "";
      const dispatcher = new StandaloneDispatcher({
        packageId: "test.standalone",
        version: "1.0.0",
        actions: [{ id: "greet", action: defineAction(() => ({ ok: true })) }],
        stderr: (msg) => (stderr += msg + "\n"),
        stdout: (msg) => (stdout += msg + "\n"),
      });

      const code = await dispatcher.dispatch(["run", "greet", "--unknownOption=456"]);
      expect(code).toBe(ExitCode.INVALID_ARGUMENT);
      expect(stderr).toContain("Hint: Separate action inputs from CLI options using '--', e.g.: ad run <id> [options] -- <param>=<val> or <param>:=<json>.");

      stderr = "";
      stdout = "";
      const jsonCode = await dispatcher.dispatch(["run", "greet", "--unknownOption=456", "--json"]);
      expect(jsonCode).toBe(ExitCode.INVALID_ARGUMENT);
      expect(stderr.trim()).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
      expect(parsed.hint).toContain("Separate action inputs from CLI options using '--'");
    });

    it("CLI run 当 ACTION_NOT_FOUND 时向 stderr 注入 list / info 发现提示", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-notfound-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
          })
        );

        const proc = await runCliAsync(["run", "nonexistent-action"], tempPkgDir);
        expect(proc.exitCode).toBe(1);
        const stderr = proc.stderr.toString();
        expect(stderr).toContain("Error [ACTION_NOT_FOUND]");
        expect(stderr).toContain("Tip: Run 'ad list' to discover available actions, or 'ad info' to inspect packages.");
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("CLI run 当 ACTION_TIMEOUT 时向 stderr 注入超时调优与异步排队提示", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-timeout-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {
              slow: { entry: "actions/slow.ts" },
            },
          })
        );
        mkdirSync(join(tempPkgDir, "actions"), { recursive: true });
        writeFileSync(
          join(tempPkgDir, "actions", "slow.ts"),
          "export default async function run() { await new Promise((r) => setTimeout(r, 2000)); return {}; }\n"
        );

        const proc = await runCliAsync(["run", "slow", "--timeout", "10ms"], tempPkgDir);
        expect(proc.exitCode).toBe(1);
        const stderr = proc.stderr.toString();
        expect(stderr).toContain("Error [ACTION_TIMEOUT]");
        expect(stderr).toContain(
          "Tip: Increase timeout via '--timeout <duration>', or run in background via '--async' and track with 'ad runs show <runId>'."
        );
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });
  });

  describe("第二阶段：能力发现与规程优先决议引导", () => {
    it("CLI 根命令帮助信息包含 Workflow Guidance 区块", async () => {
      let stdout = "";
      await main(["node", "ad", "--help"], undefined, {
        stdout: (msg) => (stdout += msg + "\n"),
      });

      expect(stdout).toContain("Workflow Guidance:");
      expect(stdout).toContain("For multi-step workflows, run 'ad playbook list' before invoking atomic actions.");
      expect(stdout).toContain("Run 'ad info [intent]' to discover packages and playbooks by keyword.");
    });

    it("ad list 人类视图尾部包含 Playbook SOP 引导 Tip", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-list-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
          })
        );

        const proc = await runCliAsync(["list"], tempPkgDir);
        expect(proc.exitCode).toBe(0);
        expect(proc.stdout.toString()).toContain(
          "Tip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures."
        );
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("ad playbook show 未找到规程时向 stderr 输出发现提示", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-pb-show-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
            playbooks: {},
          })
        );

        const proc = await runCliAsync(["playbook", "show", "nonexistent-pb"], tempPkgDir);
        expect(proc.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
        expect(proc.stderr.toString()).toContain("Tip: Run 'ad playbook list' to discover available playbooks.");
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("ad playbook validate 动作引用失效时提供新建或安装提示", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-pb-val-"));
      try {
        mkdirSync(join(tempPkgDir, "playbooks"), { recursive: true });
        writeFileSync(
          join(tempPkgDir, "playbooks", "broken-flow.md"),
          "# Broken Flow\n"
        );
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
            playbooks: {
              "broken-flow": {
                entry: "playbooks/broken-flow.md",
                description: "Broken flow",
                actions: ["missing.action"],
              },
            },
          })
        );

        const proc = await runCliAsync(["playbook", "validate", "broken-flow"], tempPkgDir);
        const stdout = proc.stdout.toString();
        expect(stdout).toContain("Hint: Action 'missing.action' not found. Run 'ad action create missing.action' to create local action, or 'ad add <pkg>' to install external dependency.");
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });
  });

  describe("第三阶段：工程上下文与依赖治理引导", () => {
    it("notInProjectError 输出三路自愈补救提示", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "ad-guidance-empty-"));
      try {
        const proc = await runCliAsync(["action", "create", "test-act"], emptyDir);
        expect(proc.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
        expect(proc.stderr.toString()).toContain(
          "Hint: Run 'ad init' to start a new project, specify '-P <id|path>' for an existing package, or run 'ad link <path>' to register it."
        );
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it("packageNotFoundError 输出依赖安装与链接提示", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-pkg-not-found-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
          })
        );

        const proc = await runCliAsync(["list", "-P", "unknown-dependency-pkg"], tempPkgDir);
        expect(proc.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
        expect(proc.stderr.toString()).toContain(
          "Hint: Package 'unknown-dependency-pkg' not found. Run 'ad add unknown-dependency-pkg' to install project dependency, or 'ad link <path>' for local development."
        );
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("ad describe 动作未找到时向 stderr 追加 discover tip", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-desc-missing-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
          })
        );

        const proc = await runCliAsync(["describe", "missing-action"], tempPkgDir);
        expect(proc.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
        expect(proc.stderr.toString()).toContain("Tip: Run 'ad list' to discover available actions.");
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("UNDECLARED_ACTION_DEPENDENCY 异常中携带 uses 声明与校验指引", () => {
      const err = new UndeclaredActionDependencyError("remote.pkg/fetch", "local.pkg/caller");
      expect(err.hint).toBe(
        "Hint: Add 'remote.pkg/fetch' to the 'uses' array of action 'local.pkg/caller' in actiondock.json, then run 'ad validate'."
      );
      expect(err.message).toContain(
        "Hint: Add 'remote.pkg/fetch' to the 'uses' array of action 'local.pkg/caller' in actiondock.json, then run 'ad validate'."
      );
    });
  });

  describe("第四阶段：机器信封提示下沉与标准流中立", () => {
    it("createErrorEnvelope 规范支持根节点 hint 且保持 details 可选", () => {
      const env = createErrorEnvelope("CUSTOM_ERROR", "Custom error msg", { foo: "bar" }, undefined, "Tip: Fix foo");
      expect(env.ok).toBe(false);
      expect(env.error.code).toBe("CUSTOM_ERROR");
      expect(env.error.message).toBe("Custom error msg");
      expect(env.error.details).toEqual({ foo: "bar" });
      expect(env.hint).toBe("Tip: Fix foo");
    });

    it("机器模式下 --json 错误信封中根节点自动写入 hint 且无非格式化 stderr 文本", async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), "ad-guidance-nip-json-"));
      try {
        const proc = await runCliAsync(["action", "create", "test-act", "--json"], emptyDir);
        expect(proc.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
        expect(proc.stderr.toString().trim()).toBe("");

        const parsed = JSON.parse(proc.stdout.toString());
        expect(parsed.ok).toBe(false);
        expect(parsed.hint).toContain("Run 'ad init' to start a new project");
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it("机器模式与文本模式功能完全对等：ad info --json 携带 hints 数组", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ad-guidance-info-json-"));
      try {
        await runCliAsync(["init", "--id", "test.hints-pkg", "--name", "Hints Pkg"], tempDir);
        const infoProc = await runCliAsync(["info", "--json"], tempDir);
        expect(infoProc.exitCode).toBe(0);

        const info = JSON.parse(infoProc.stdout.toString());
        expect(info.id).toBe("test.hints-pkg");
        expect(Array.isArray(info.hints)).toBe(true);
        expect(info.hints.some((h: string) => h.includes("Run 'ad list'"))).toBe(false);
        expect(info.hints.some((h: string) => h.includes("Run 'ad playbook show <id>'"))).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("机器模式与文本模式功能完全对等：ad playbook show --json 携带 hints 数组", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ad-guidance-pb-show-json-"));
      try {
        await runCliAsync(["init", "--id", "test.pb-hints", "--name", "Playbook Hints"], tempDir);
        const pbShowProc = await runCliAsync(["playbook", "show", "greet-user", "--json"], tempDir);
        expect(pbShowProc.exitCode).toBe(0);

        const detail = JSON.parse(pbShowProc.stdout.toString());
        expect(detail.id).toBe("greet-user");
        expect(Array.isArray(detail.hints)).toBe(true);
        expect(detail.hints.some((h: string) => h.includes("Follow steps sequentially"))).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("ad describe 动作未找到时在 --json 模式下其错误信封根节点携带 discover tip", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-desc-json-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
          })
        );

        const proc = await runCliAsync(["describe", "missing-action", "--json"], tempPkgDir);
        expect(proc.exitCode).toBe(ExitCode.INVALID_ARGUMENT);
        expect(proc.stderr.toString().trim()).toBe("");

        const parsed = JSON.parse(proc.stdout.toString());
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe("ACTION_NOT_FOUND");
        expect(parsed.hint).toBe("Tip: Run 'ad list' to discover available actions.");
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("CLI run 当 ACTION_NOT_FOUND 时在 --json 模式下向根节点写入发现提示", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-run-notfound-json-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
          })
        );

        const proc = await runCliAsync(["run", "nonexistent-action", "--json"], tempPkgDir);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString().trim()).toBe("");

        const parsed = JSON.parse(proc.stdout.toString());
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe("ACTION_NOT_FOUND");
        expect(parsed.hint).toBe("Tip: Run 'ad list' to discover available actions, or 'ad info' to inspect packages.");
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("CLI run 当 ACTION_TIMEOUT 时在 --json 模式下向根节点写入超时调优与异步排队提示", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-timeout-json-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {
              slow: { entry: "actions/slow.ts" },
            },
          })
        );
        mkdirSync(join(tempPkgDir, "actions"), { recursive: true });
        writeFileSync(
          join(tempPkgDir, "actions", "slow.ts"),
          "export default async function run() { await new Promise((r) => setTimeout(r, 2000)); return {}; }\n"
        );

        const proc = await runCliAsync(["run", "slow", "--timeout", "10ms", "--json"], tempPkgDir);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString().trim()).toBe("");

        const parsed = JSON.parse(proc.stdout.toString());
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe("ACTION_TIMEOUT");
        expect(parsed.hint).toBe(
          "Tip: Increase timeout via '--timeout <duration>', or run in background via '--async' and track with 'ad runs show <runId>'."
        );
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });
  });

  describe("第三阶段：机器模式与人类模式完全对等信封与全自提示体系", () => {
    it("ad list --json 输出顶层对象信封且携带根节点 hints，列表项未被污染", async () => {
      const tempHomeDir = mkdtempSync(join(tmpdir(), "ad-guidance-list-home-"));
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-list-json-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {
              "demo.echo": { entry: "actions/echo.ts", description: "Echo action" },
            },
          })
        );

        const proc = await runCliAsync(["list", "--json"], tempPkgDir, {
          ACTIONDOCK_HOME: tempHomeDir,
        });
        expect(proc.exitCode).toBe(0);
        const parsed = JSON.parse(proc.stdout.toString());
        expect(Array.isArray(parsed)).toBe(false);
        expect(Array.isArray(parsed.items)).toBe(true);
        expect(parsed.items.length).toBe(1);
        expect(parsed.items[0].id).toBe("demo.echo");
        expect(parsed.items[0].hints).toBeUndefined();
        expect(parsed.hints).toEqual([
          "Tip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures.",
        ]);
      } finally {
        rmSync(tempHomeDir, { recursive: true, force: true });
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("ad playbook list --json 输出顶层对象信封且携带根节点 hints", async () => {
      const tempHomeDir = mkdtempSync(join(tmpdir(), "ad-guidance-pb-home-"));
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-pb-list-json-"));
      try {
        mkdirSync(join(tempPkgDir, "playbooks"), { recursive: true });
        writeFileSync(join(tempPkgDir, "playbooks", "deploy.md"), "# Deploy\n");
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.pkg",
            name: "test.pkg",
            version: "1.0.0",
            actions: {},
            playbooks: {
              "sop-deploy": { entry: "playbooks/deploy.md", description: "Deploy SOP" },
            },
          })
        );

        const proc = await runCliAsync(["playbook", "list", "--json"], tempPkgDir, {
          ACTIONDOCK_HOME: tempHomeDir,
        });
        expect(proc.exitCode).toBe(0);
        const parsed = JSON.parse(proc.stdout.toString());
        expect(Array.isArray(parsed)).toBe(false);
        expect(Array.isArray(parsed.items)).toBe(true);
        expect(parsed.items.length).toBe(1);
        expect(parsed.items[0].id).toBe("sop-deploy");
        expect(parsed.hints).toEqual([
          "Tip: Run 'ad playbook show <id>' to inspect procedure steps before execution.",
        ]);
      } finally {
        rmSync(tempHomeDir, { recursive: true, force: true });
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("ad info 多包查询与回退在 --json 模式下根节点注入 hints", async () => {
      const tempHomeDir = mkdtempSync(join(tmpdir(), "ad-guidance-info-home-"));
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-info-pkg-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.multi-pkg",
            name: "test.multi-pkg",
            version: "1.0.0",
            actions: {},
          })
        );

        // 搜索无匹配时
        const noMatchProc = await runCliAsync(
          ["info", "--intent", "nonexistent-xyz", "--json"],
          tempPkgDir,
          { ACTIONDOCK_HOME: tempHomeDir }
        );
        expect(noMatchProc.exitCode).toBe(0);
        const noMatchParsed = JSON.parse(noMatchProc.stdout.toString());
        expect(noMatchParsed.hints).toEqual([
          "Tip: Run 'ad info <package-id>' to view detailed package configuration and schema.",
        ]);

        // 搜索命中时
        const matchProc = await runCliAsync(
          ["info", "--intent", "multi", "--json"],
          tempPkgDir,
          { ACTIONDOCK_HOME: tempHomeDir }
        );
        expect(matchProc.exitCode).toBe(0);
        const matchParsed = JSON.parse(matchProc.stdout.toString());
        expect(matchParsed.hints).toEqual([
          "Tip: Run 'ad info <package-id>' to view detailed package configuration and schema.",
        ]);
      } finally {
        rmSync(tempHomeDir, { recursive: true, force: true });
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("ad config schema 在存在未配置必需项时向根节点追加自愈 hints", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-cfg-schema-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.cfg-req",
            name: "test.cfg-req",
            version: "1.0.0",
            config: {
              DATABASE_URL: {
                description: "Main DB connection URL",
                required: true,
              },
            },
            actions: {},
          })
        );

        const proc = await runCliAsync(["config", "schema", "--json"], tempPkgDir);
        expect(proc.exitCode).toBe(1);
        const parsed = JSON.parse(proc.stdout.toString());
        expect(parsed.ok).toBe(false);
        expect(parsed.missingCount).toBe(1);
        expect(parsed.hints).toEqual([
          "Tip: Run 'ad config set <KEY> <val>' to configure required settings.",
        ]);
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });

    it("ad describe --json 自省载荷下沉 syntaxReference 语法速查", async () => {
      const tempPkgDir = mkdtempSync(join(tmpdir(), "ad-guidance-describe-json-"));
      try {
        writeFileSync(
          join(tempPkgDir, "actiondock.json"),
          JSON.stringify({
            id: "test.describe-pkg",
            name: "test.describe-pkg",
            version: "1.0.0",
            actions: {
              "demo.greet": {
                entry: "actions/greet.ts",
                description: "Greet user",
                inputSchema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    count: { type: "number" },
                  },
                  required: ["name"],
                },
              },
            },
          })
        );

        const proc = await runCliAsync(["describe", "demo.greet", "--json"], tempPkgDir);
        expect(proc.exitCode).toBe(0);
        const parsed = JSON.parse(proc.stdout.toString());
        expect(parsed.id).toBe("demo.greet");
        expect(parsed.inputAdvice.recommendedMode).toBe("flat");
        expect(Array.isArray(parsed.syntaxReference)).toBe(true);
        expect(parsed.syntaxReference.some((l: string) => l.includes('key="value"'))).toBe(true);
        expect(parsed.syntaxReference.some((l: string) => l.includes("count:=10"))).toBe(true);
        expect(parsed.syntaxReference.some((l: string) => l.includes("--input-file"))).toBe(true);
      } finally {
        rmSync(tempPkgDir, { recursive: true, force: true });
      }
    });
  });
});
