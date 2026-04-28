import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../lib/command.js";
import { ActionDockCliError } from "../lib/error.js";
import { buildSelfUpdatePlan, resolveSelfUpdateTarget, runSelfUpdatePlan } from "../lib/self-update.js";

export default class SelfUpdateCommand extends BaseCommand {
  static description = "Update the CLI via npm";

  static args = {
    target: Args.string({
      description: "npm dist-tag or version to install",
      required: false,
    }),
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "dry-run": Flags.boolean({
      description: "Print the npm command without executing it",
    }),
    help: Flags.help({ char: "h" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SelfUpdateCommand);

    try {
      const packageName = typeof this.config.pjson.name === "string" ? this.config.pjson.name : "@actiondock/cli";
      const currentVersion = this.config.version;
      const target = resolveSelfUpdateTarget(args.target);
      const plan = buildSelfUpdatePlan({ packageName, target });

      if (flags["dry-run"]) {
        if (flags.json) {
          this.printJson({
            packageName,
            currentVersion,
            target,
            command: plan.command,
            executable: plan.executable,
            args: plan.args,
            dryRun: true,
          });
          return;
        }

        this.log(plan.command);
        return;
      }

      this.log(`Running: ${plan.command}`);
      const exitCode = await runSelfUpdatePlan(plan);
      if (exitCode !== 0) {
        throw new ActionDockCliError(`自升级失败，npm 退出码: ${exitCode}`, 1);
      }

      if (flags.json) {
        this.printJson({
          packageName,
          currentVersion,
          target,
          command: plan.command,
          updated: true,
        });
        return;
      }

      this.log("Update command completed.");
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
