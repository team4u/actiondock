import { setupNodeRuntime } from "@actiondock/runtime-node";
import { createCliProgram } from "./commands";

export * from "./commands";

/**
 * ActionDock CLI 主执行入口函数。
 * 
 * @param argv 命令行参数数组（默认使用 process.argv）
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  setupNodeRuntime();
  const program = createCliProgram();
  await program.parseAsync(argv);
}

if ((import.meta as any).main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
