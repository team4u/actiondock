import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCliProgram,
  isNodeArgv,
  resolveTargetSubcommand,
  main,
  ExitCode,
} from "../src/index.ts";

describe("CLI 动态按需懒加载与子命令解析边缘情况测试", () => {
  describe("isNodeArgv 契约推导", () => {
    it("正确识别标准 Node/Bun/Tsx 进程启动参数", () => {
      assert.strictEqual(isNodeArgv(["node", "ad", "run", "greet"]), true);
      assert.strictEqual(isNodeArgv(["/usr/local/bin/node", "/path/to/ad.js", "action", "list"]), true);
      assert.strictEqual(isNodeArgv(["bun", "/path/to/ad.js", "config", "list"]), true);
      assert.strictEqual(isNodeArgv(["/root/.bun/bin/bun", "bin/ad.js", "playbook", "list"]), true);
      assert.strictEqual(isNodeArgv(["tsx", "src/index.ts", "runs", "list"]), true);
      assert.strictEqual(isNodeArgv(["deno", "ad.js", "info"]), true);
      assert.strictEqual(isNodeArgv(["C:\\Program Files\\nodejs\\node.exe", "ad.js", "doctor"]), true);
    });

    it("正确判定纯用户输入参数并非 Node 启动参数", () => {
      // 子命令直接调用
      assert.strictEqual(isNodeArgv(["action", "list"]), false);
      assert.strictEqual(isNodeArgv(["run", "src/action.ts"]), false);
      assert.strictEqual(isNodeArgv(["describe", "./actions/greet.ts"]), false);
      assert.strictEqual(isNodeArgv(["init", "./my-project"]), false);
      assert.strictEqual(isNodeArgv(["link", "/workspace/pkg"]), false);
      assert.strictEqual(isNodeArgv(["unlink", "demo-pkg"]), false);

      // 选项在前
      assert.strictEqual(isNodeArgv(["--data-dir", "/tmp/data", "run", "greet"]), false);
      assert.strictEqual(isNodeArgv(["--json", "action", "list"]), false);
      assert.strictEqual(isNodeArgv(["--help"]), false);
      assert.strictEqual(isNodeArgv(["-v"]), false);

      // 空数组与单元素
      assert.strictEqual(isNodeArgv([]), false);
      assert.strictEqual(isNodeArgv(["node"]), false);
    });
  });

  describe("resolveTargetSubcommand 解析行为与边界场景", () => {
    it("Node 前置模式下正确解析顶级子命令", () => {
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "run", "greet"]),
        "run"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["/usr/bin/node", "ad.js", "describe", "greet"]),
        "describe"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "action", "list"]),
        "action"
      );
    });

    it("纯用户参数模式下正确解析子命令（即便包含路径或文件扩展名）", () => {
      assert.strictEqual(resolveTargetSubcommand(["action", "list"]), "action");
      assert.strictEqual(resolveTargetSubcommand(["run", "src/action.ts"]), "run");
      assert.strictEqual(resolveTargetSubcommand(["describe", "./actions/greet.ts"]), "describe");
      assert.strictEqual(resolveTargetSubcommand(["init", "./new-project"]), "init");
    });

    it("支持 parseOptions 指定 from: user 与 from: node", () => {
      assert.strictEqual(
        resolveTargetSubcommand(["run", "test-act"], { from: "user" }),
        "run"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "run", "test-act"], { from: "node" }),
        "run"
      );
    });

    it("正确跳过前置全局选项（--data-dir、--json、-v 等）解析出真实子命令", () => {
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "--data-dir", "/tmp/custom-data", "run", "list-prs"]),
        "run"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "--data-dir=/tmp/custom-data", "run", "list-prs"]),
        "run"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "--json", "--data-dir", "/tmp/custom-data", "action", "list"]),
        "action"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["--data-dir", "/tmp/custom-data", "run", "list-prs"]),
        "run"
      );
    });

    it("正确处理 Commander 内置 help 命令", () => {
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "help", "run"]),
        "run"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "help", "action"]),
        "action"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "help", "config"]),
        "config"
      );
      assert.strictEqual(
        resolveTargetSubcommand(["node", "ad", "help"]),
        "help"
      );
    });

    it("全局仅有帮助或版本标志时返回 null", () => {
      assert.strictEqual(resolveTargetSubcommand(["node", "ad", "--help"]), null);
      assert.strictEqual(resolveTargetSubcommand(["node", "ad", "-h"]), null);
      assert.strictEqual(resolveTargetSubcommand(["node", "ad", "-v"]), null);
      assert.strictEqual(resolveTargetSubcommand(["node", "ad", "--version"]), null);
      assert.strictEqual(resolveTargetSubcommand(["node", "ad", "-V"]), null);
    });
  });

  describe("多级嵌套子命令动态挂载与执行", () => {
    async function parseIgnoringHelp(p: any, argv: string[]) {
      try {
        await p.parseAsync(argv);
      } catch (err: any) {
        if (err?.code !== "commander.helpDisplayed" && err?.exitCode !== 0) {
          throw err;
        }
      }
    }

    it("action 二级命令族挂载校验（list、describe、run）", async () => {
      const program = createCliProgram();
      await parseIgnoringHelp(program, ["node", "ad", "action", "--help"]);
      const actionCmd = program.commands.find((c) => c.name() === "action");
      assert.ok(actionCmd, "action 命令应被真实挂载");
      const subNames = actionCmd.commands.map((c) => c.name());
      assert.ok(subNames.includes("list"), "应包含 action list");
      assert.ok(subNames.includes("describe"), "应包含 action describe");
      assert.ok(subNames.includes("run"), "应包含 action run");
      assert.ok(subNames.includes("create"), "应包含 action create");
      assert.ok(subNames.includes("validate"), "应包含 action validate");
    });

    it("config 二级命令族挂载校验（list、get）", async () => {
      const program = createCliProgram();
      await parseIgnoringHelp(program, ["node", "ad", "config", "--help"]);
      const configCmd = program.commands.find((c) => c.name() === "config");
      assert.ok(configCmd, "config 命令应被真实挂载");
      const subNames = configCmd.commands.map((c) => c.name());
      assert.ok(subNames.includes("list"), "应包含 config list");
      assert.ok(subNames.includes("get"), "应包含 config get");
      assert.ok(subNames.includes("set"), "应包含 config set");
      assert.ok(subNames.includes("schema"), "应包含 config schema");
    });

    it("playbook 二级命令族挂载校验（list、show、validate、create）及未知 run 错误", async () => {
      const program = createCliProgram();
      await parseIgnoringHelp(program, ["node", "ad", "playbook", "--help"]);
      const pbCmd = program.commands.find((c) => c.name() === "playbook");
      assert.ok(pbCmd, "playbook 命令应被真实挂载");
      const subNames = pbCmd.commands.map((c) => c.name());
      assert.ok(subNames.includes("list"), "应包含 playbook list");
      assert.ok(subNames.includes("show"), "应包含 playbook show");
      assert.ok(subNames.includes("validate"), "应包含 playbook validate");
      assert.ok(subNames.includes("create"), "应包含 playbook create");
      assert.strictEqual(subNames.includes("run"), false, "playbook 本身不设 run 子命令，动作由 ad run 执行");
    });

    it("runs 二级命令族挂载校验（list、show、clear、cancel）", async () => {
      const program = createCliProgram();
      await parseIgnoringHelp(program, ["node", "ad", "runs", "--help"]);
      const runsCmd = program.commands.find((c) => c.name() === "runs");
      assert.ok(runsCmd, "runs 命令应被真实挂载");
      const subNames = runsCmd.commands.map((c) => c.name());
      assert.ok(subNames.includes("list"), "应包含 runs list");
      assert.ok(subNames.includes("show"), "应包含 runs show");
      assert.ok(subNames.includes("clear"), "应包含 runs clear");
      assert.ok(subNames.includes("cancel"), "应包含 runs cancel");
    });

    it("link 与 unlink 共享模块联动挂载校验", async () => {
      // 触发 link 会同步把 unlink 真实命令挂载，并清理二者的占位节点
      const program = createCliProgram();
      await parseIgnoringHelp(program, ["node", "ad", "link", "--help"]);
      const linkCmd = program.commands.find((c) => c.name() === "link");
      const unlinkCmd = program.commands.find((c) => c.name() === "unlink");
      assert.ok(linkCmd, "link 命令应被真实挂载");
      assert.ok(unlinkCmd, "unlink 命令应一并被真实挂载");
    });
  });

  describe("并发调用与竞态安全", () => {
    async function parseIgnoringHelp(p: any, argv: string[]) {
      try {
        await p.parseAsync(argv);
      } catch (err: any) {
        if (err?.code !== "commander.helpDisplayed" && err?.exitCode !== 0) {
          throw err;
        }
      }
    }

    it("并发调用同一子命令时保证单例加载且无竞态报错", async () => {
      const program = createCliProgram();
      await Promise.all([
        parseIgnoringHelp(program, ["node", "ad", "action", "--help"]),
        parseIgnoringHelp(program, ["node", "ad", "action", "--help"]),
        parseIgnoringHelp(program, ["node", "ad", "action", "--help"]),
      ]);
      const actionCommands = program.commands.filter((c) => c.name() === "action");
      assert.strictEqual(actionCommands.length, 1, "同一命令在程序树中应保持唯一节点");
    });

    it("并发调用共享 loader 的命令（link 与 unlink）无冲突", async () => {
      const program = createCliProgram();
      await Promise.all([
        parseIgnoringHelp(program, ["node", "ad", "link", "--help"]),
        parseIgnoringHelp(program, ["node", "ad", "unlink", "--help"]),
      ]);
      const linkCommands = program.commands.filter((c) => c.name() === "link");
      const unlinkCommands = program.commands.filter((c) => c.name() === "unlink");
      assert.strictEqual(linkCommands.length, 1, "link 节点唯一");
      assert.strictEqual(unlinkCommands.length, 1, "unlink 节点唯一");
    });
  });

  describe("main() 端到端边缘参数与未知命令退出表现", () => {
    it("ad --help 正常输出并返回 0", async () => {
      const exitCode = await main(["node", "ad", "--help"]);
      assert.strictEqual(exitCode, 0);
    });

    it("ad help run 正常输出并返回 0", async () => {
      const exitCode = await main(["node", "ad", "help", "run"]);
      assert.strictEqual(exitCode, 0);
    });

    it("ad action --help 正常输出并返回 0", async () => {
      const exitCode = await main(["node", "ad", "action", "--help"]);
      assert.strictEqual(exitCode, 0);
    });

    it("ad foo-not-exist 严格返回退出码 1", async () => {
      let errOutput = "";
      const exitCode = await main(["node", "ad", "foo-not-exist"], undefined, {
        stderr: (msg) => {
          errOutput += msg;
        },
      });
      assert.strictEqual(exitCode, ExitCode.FAILURE);
      assert.ok(errOutput.includes("unknown command 'foo-not-exist'"));
    });

    it("ad playbook run 未知子命令返回退出码 1", async () => {
      let errOutput = "";
      const exitCode = await main(["node", "ad", "playbook", "run"], undefined, {
        stderr: (msg) => {
          errOutput += msg;
        },
      });
      assert.strictEqual(exitCode, ExitCode.FAILURE);
      assert.ok(errOutput.includes("unknown command 'run'"));
    });

    it("纯参数模式 main(['describe', './actions/greet.ts']) 正常识别并执行", async () => {
      let errOutput = "";
      const exitCode = await main(["describe", "./actions/greet.ts"], undefined, {
        stderr: (msg) => {
          errOutput += msg;
        },
      });
      // 目标包找不到属于语义校验阶段（返回 ExitCode.INVALID_ARGUMENT），证明成功进入 describe 实现，而非被误吞
      assert.strictEqual(exitCode, ExitCode.INVALID_ARGUMENT);
      assert.ok(errOutput.includes("Package './actions' not found"));
    });
  });
});
