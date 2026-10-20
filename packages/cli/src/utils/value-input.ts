import { Command, Option } from "commander";
import { ArgumentError } from "../errors";
import type { StoredValueInput } from "../services/value-input";

const tracked = new WeakSet<Command>();
const fieldTails = new WeakMap<Command, string[]>();

/**
 * 让 Commander 自己判定分隔符，记录被父级吞掉的 --，不扫描或复制选项语法。
 * 探测器只复制选项形状，不复制回调，不能触发真实命令副作用。
 */
function trackValueBoundary(command: Command): void {
  for (let current: Command | null = command; current; current = current.parent) {
    if (tracked.has(current)) continue;
    tracked.add(current);
    const parse = current.parseOptions;
    current.parseOptions = function (argv: string[]) {
      fieldTails.delete(this);
      const result = parse.call(this, argv);
      // 有未知参数时 Commander 会保留分隔符，由下一级继续处理。
      if (result.unknown.length > 0) return result;
      const probe = new Command().copyInheritedSettings(this);
      for (const option of this.options) probe.addOption(new Option(option.flags));
      // 前置未知标记让 Commander 保留真正的 --；选项值中的 -- 仍由其正常消费。
      const { unknown } = probe.parseOptions(["--\u0000value-input-probe", ...argv]);
      const boundary = unknown.indexOf("--");
      if (boundary >= 0) fieldTails.set(this, unknown.slice(boundary + 1));
      return result;
    };
  }
}

export function addStoredValueOptions(command: Command): Command {
  trackValueBoundary(command);
  return command
    .option("--stdin", "Read a complete value from stdin (JSON or string)")
    .option("--stdin-field <field>", "Bind raw stdin text to a top-level value field");
}

/** 分隔符前最多一个完整值，之后的参数全部交给共享扁平解码器。 */
export function splitStoredValueArgs(command: Command, values: string[] = []): StoredValueInput {
  let fields: string[] | undefined;
  for (let current: Command | null = command; current; current = current.parent) {
    if (fieldTails.has(current)) fields = fieldTails.get(current);
  }
  const fieldCount = fields?.length ?? 0;
  if (fieldCount > values.length) throw new ArgumentError("The key must appear before '--'.");
  const complete = values.slice(0, values.length - fieldCount);
  if (complete.length > 1) throw new ArgumentError("Only one complete value is allowed; put flat assignments after '--'.");
  return { ...(complete.length ? { value: complete[0] } : {}), ...(fields !== undefined ? { flatArgs: fields } : {}) };
}
