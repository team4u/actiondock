import { resolve } from "node:path";

/**
 * 构建时 Action 导入映射。
 */
export interface ActionImport {
  /** Action 唯一标识符 */
  id: string;
  /** Action 源码文件物理路径 */
  filePath: string;
}

/**
 * 动态生成 Standalone 独立可执行文件的 TypeScript 入口文件源码。
 * 
 * @param packageId 所属 Package ID
 * @param version 版本号
 * @param description 描述
 * @param actions 待打包 Action 列表
 * @param configDefs 声明的配置定义字典
 */
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

app.run(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
`;
}
