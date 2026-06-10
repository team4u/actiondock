import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "../../lib/command.js";
import { ActionDockCliError } from "../../lib/error.js";
import { renderScriptDetail } from "../../lib/render.js";
import { buildSchemaReplacePatch, parsePatchObject, parseSchemaInput, resolveOptionalTextInput, resolveScriptSource, setPatchField } from "../../lib/script.js";

export default class ScriptPatchCommand extends BaseCommand {
  static description = "Apply a JSON Merge Patch to an ActionDock draft script";

  static args = {
    scriptId: Args.string({ required: true })
  };

  static flags = {
    ...BaseCommand.baseFlags,
    "patch-json": Flags.string({
      description: "Inline JSON Merge Patch object"
    }),
    "patch-file": Flags.string({
      description: "Path to a JSON file containing a Merge Patch object"
    }),
    name: Flags.string({
      description: "Replace script name"
    }),
    description: Flags.string({
      description: "Replace script description"
    }),
    desc: Flags.string({
      description: "Alias for --description"
    }),
    source: Flags.string({
      description: "Replace script source inline"
    }),
    "source-file": Flags.string({
      description: "Replace script source using a text file"
    }),
    "python-requirements": Flags.string({
      description: "Replace pythonRequirements inline"
    }),
    "python-requirements-file": Flags.string({
      description: "Replace pythonRequirements using a requirements.txt file"
    }),
    "input-schema-json": Flags.string({
      description: "Replace inputSchema using an inline JSON object"
    }),
    "input-schema-file": Flags.string({
      description: "Replace inputSchema using a JSON file"
    }),
    "output-schema-json": Flags.string({
      description: "Replace outputSchema using an inline JSON object"
    }),
    "output-schema-file": Flags.string({
      description: "Replace outputSchema using a JSON file"
    }),
    ...BaseCommand.connectionFlags,
    help: Flags.help({ char: "h" })
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ScriptPatchCommand);

    try {
      const patch = parsePatchObject(flags["patch-json"], flags["patch-file"]);
      if (flags.name !== undefined) {
        setPatchField(patch, "name", flags.name);
      }
      if (flags.description !== undefined && flags.desc !== undefined) {
        throw new ActionDockCliError("`--description` 和 `--desc` 不能同时使用。", 2);
      }
      const description = flags.description ?? flags.desc;
      if (description !== undefined) {
        setPatchField(patch, "description", description);
      }

      const source = resolveScriptSource(flags.source, flags["source-file"], false);
      if (source !== undefined) {
        setPatchField(patch, "source", source);
      }
      const pythonRequirements = resolveOptionalTextInput(flags["python-requirements"], flags["python-requirements-file"], {
        valueFlag: "`--python-requirements`",
        fileFlag: "`--python-requirements-file`"
      });
      if (pythonRequirements !== undefined) {
        setPatchField(patch, "pythonRequirements", pythonRequirements);
      }

      const inputSchema = parseSchemaInput(flags["input-schema-json"], flags["input-schema-file"], {
        jsonFlag: "`--input-schema-json`",
        fileFlag: "`--input-schema-file`"
      });
      const outputSchema = parseSchemaInput(flags["output-schema-json"], flags["output-schema-file"], {
        jsonFlag: "`--output-schema-json`",
        fileFlag: "`--output-schema-file`"
      });

      if (Object.keys(patch).length === 0 && inputSchema === undefined && outputSchema === undefined) {
        throw new ActionDockCliError("至少需要提供一个 Patch 字段。", 2);
      }

      const client = this.getClient(flags);

      // Schema 标志使用替换语义：先获取当前 schema，为被删除的属性生成 null 条目
      if (inputSchema !== undefined || outputSchema !== undefined) {
        const current = await client.scripts.get(args.scriptId, true);
        if (inputSchema !== undefined) {
          setPatchField(patch, "inputSchema", buildSchemaReplacePatch(current.inputSchema, inputSchema));
        }
        if (outputSchema !== undefined) {
          setPatchField(patch, "outputSchema", buildSchemaReplacePatch(current.outputSchema, outputSchema));
        }
      }

      const script = await client.scripts.patch(args.scriptId, patch);

      if (flags.json) {
        this.printJson(script);
        return;
      }

      this.log(renderScriptDetail(script, "draft"));
    } catch (error) {
      this.handleError(error, flags.json);
    }
  }
}
