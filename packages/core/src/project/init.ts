import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * 项目初始化脚手架选项。
 */
export interface InitOptions {
  /** 自定义项目 ID（默认使用目录名） */
  id?: string;
  /** 自定义项目展示名称（默认由目录名美化生成） */
  name?: string;
  /** 自定义项目描述 */
  description?: string;
}

/**
 * 在目标目录初始化一个完整的 ActionDock 2.0 Action Package 脚手架。
 * 生成内容包括：
 * - actiondock.json（项目元数据、Action 与 Playbook 声明的单一事实源）
 * - package.json（Node.js 标准脚本与依赖声明）
 * - tsconfig.json（现代 NodeNext 模块规范）
 * - .gitignore（排除持久化 db、node_modules、dist）
 * - actions/greet.ts（标准示例 Action 执行 Handler，演示 config、state、log 使用）
 * - playbooks/greet-user.md（纯 Markdown 标准 SOP Playbook 演示）
 * - tests/greet.test.ts（基于 node:test 与 @actiondock/testing 的测试用例）
 * 
 * @param targetDir 目标项目目录
 * @param options 初始化选项
 */
export function initProject(targetDir: string, options: InitOptions = {}): void {
  const root = resolve(targetDir);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  const dirName = basename(root);
  const id = options.id || dirName;
  const name = options.name || dirName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const description = options.description || "ActionDock AI Agent Actions";

  // 1. actiondock.json（单一事实源）
  const actiondockJson = {
    $schema: "https://actiondock.dev/schema/v2.json",
    schemaVersion: 2,
    id,
    name,
    version: "0.1.0",
    description,
    config: {
      SAMPLE_GREETING: {
        description: "Default greeting message",
        default: "Hello",
      },
    },
    actions: {
      "sample.greet": {
        entry: "actions/greet.ts",
        description: "Greeting action demonstrating basic input, config, and state usage",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the person to greet",
            },
          },
          required: ["name"],
        },
        outputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
            timesGreeted: { type: "number" },
          },
          required: ["message", "timesGreeted"],
        },
        tags: ["sample"],
        uses: [],
      },
    },
    playbooks: {
      "greet-user": {
        entry: "playbooks/greet-user.md",
        description: "SOP for greeting a new user and verifying system health",
        actions: ["sample.greet"],
      },
    },
  };
  writeFileSync(
    join(root, "actiondock.json"),
    JSON.stringify(actiondockJson, null, 2) + "\n"
  );

  // 2. package.json
  const packageJson = {
    name: id,
    version: "0.1.0",
    description,
    type: "module",
    scripts: {
      test: "node --import tsx --test tests/*.test.ts",
    },
    engines: {
      node: ">=24.12.0",
    },
    dependencies: {
      "@actiondock/sdk": "^2.1.0",
    },
    devDependencies: {
      "@actiondock/testing": "^2.1.0",
      "@types/node": "^22.13.0",
      "tsx": "^4.19.0",
      "typescript": "^5.7.0",
    },
  };
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(packageJson, null, 2) + "\n"
  );

  // 3. tsconfig.json
  const tsconfigJson = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: true,
      types: ["node"],
    },
  };
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(tsconfigJson, null, 2) + "\n"
  );

  // 4. .gitignore
  const gitignore = `.actiondock/
node_modules/
dist/
build/
*.log
.env
`;
  writeFileSync(join(root, ".gitignore"), gitignore);

  // 5. actions/
  const actionsDir = join(root, "actions");
  mkdirSync(actionsDir, { recursive: true });

  const sampleAction = `import { defineAction } from "@actiondock/sdk";

export default defineAction(async (input: { name: string }, ctx) => {
  const greeting = ctx.config.get("SAMPLE_GREETING", "Hello");
  const count = ((await ctx.state.get<number>("greet_count")) || 0) + 1;
  await ctx.state.set("greet_count", count);

  ctx.log.info(\`Greeting \${input.name} (times greeted: \${count})\`);

  return {
    message: \`\${greeting}, \${input.name}!\`,
    timesGreeted: count,
  };
});
`;
  writeFileSync(join(actionsDir, "greet.ts"), sampleAction);

  // 6. playbooks/
  const playbooksDir = join(root, "playbooks");
  mkdirSync(playbooksDir, { recursive: true });

  const samplePlaybook = `# Greeting SOP

- Call \`sample.greet\` with the user's name.
- Confirm the returned greeting message.
`;
  writeFileSync(join(playbooksDir, "greet-user.md"), samplePlaybook);

  // 7. tests/
  const testsDir = join(root, "tests");
  mkdirSync(testsDir, { recursive: true });

  const sampleTest = `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestRuntime } from "@actiondock/testing";
import greetAction from "../actions/greet";

describe("greet action", () => {
  it("should greet user with greeting and increment count", async () => {
    const runtime = createTestRuntime({
      config: { SAMPLE_GREETING: "Hi" },
    });

    const res1 = await runtime.run(greetAction, { name: "Alice" });
    assert.equal(res1.message, "Hi, Alice!");
    assert.equal(await runtime.state.get("greet_count"), 1);

    const res2 = await runtime.run(greetAction, { name: "Bob" });
    assert.equal(res2.message, "Hi, Bob!");
    assert.equal(await runtime.state.get("greet_count"), 2);
  });
});
`;
  writeFileSync(join(testsDir, "greet.test.ts"), sampleTest);
}
