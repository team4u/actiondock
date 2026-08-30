export * from "./commands";

import { createCliProgram } from "./commands";

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createCliProgram();
  await program.parseAsync(argv);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
