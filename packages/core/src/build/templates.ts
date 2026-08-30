import { resolve } from "node:path";

export interface ActionImport {
  id: string;
  filePath: string;
}

export function generateStandaloneEntrypoint(
  packageId: string,
  version: string,
  description: string | undefined,
  actions: ActionImport[],
  configDefs?: Record<string, unknown>
): string {
  // Resolve path to standalone runtime inside @actiondock/cli
  const standaloneRuntimePath = resolve(__dirname, "../runtime/standalone");

  const imports = actions
    .map((a, idx) => `import action_${idx} from ${JSON.stringify(a.filePath)};`)
    .join("\n");

  const actionArray = actions
    .map((_, idx) => `action_${idx}`)
    .join(",\n    ");

  return `// AUTO-GENERATED ENTRYPOINT BY ACTIONDOCK BUILDER. DO NOT EDIT.
import { createStandaloneRuntime } from ${JSON.stringify(standaloneRuntimePath)};
${imports}

const app = createStandaloneRuntime({
  packageId: ${JSON.stringify(packageId)},
  version: ${JSON.stringify(version)},
  description: ${JSON.stringify(description || "")},
  config: ${JSON.stringify(configDefs || {})},
  actions: [
    ${actionArray}
  ],
});

await app.run(process.argv.slice(2));
`;
}
