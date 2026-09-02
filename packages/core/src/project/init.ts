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
 * 1. actiondock.json（项目元数据与配置声明）
 * 2. package.json（模块依赖与 bun test 脚本）
 * 3. tsconfig.json（现代 ESNext / Bundler 编译配置）
 * 4. .gitignore（排除持久化 db、node_modules、dist）
 * 5. actions/greet.ts（标准示例 Action，演示 config、state、log 使用）
 * 6. playbooks/greet-user.md（标准 SOP Playbook 演示）
 * 7. tests/greet.test.ts（基于 createTestRuntime 的零依赖单元测试）
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

  // 1. actiondock.json
  const actiondockJson = {
    id,
    name,
    version: "0.1.0",
    description,
    actionsDir: "actions",
    playbooksDir: "playbooks",
    config: {
      SAMPLE_GREETING: {
        description: "Default greeting message",
        default: "Hello",
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
      test: "bun test",
    },
    dependencies: {
      "@actiondock/sdk": "^2.0.0",
    },
    devDependencies: {
      "@types/bun": "latest",
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
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      types: ["bun-types"],
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
bun.lock
*.db
`;
  writeFileSync(join(root, ".gitignore"), gitignore);

  // 5. actions/
  const actionsDir = join(root, "actions");
  mkdirSync(actionsDir, { recursive: true });

  const sampleAction = `import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.greet",
  description: "Greet a user with configurable greeting",

  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of person to greet" },
    },
    required: ["name"],
  },

  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      timestamp: { type: "string" },
    },
    required: ["message", "timestamp"],
  },

  async run(input: { name: string }, ctx) {
    const greeting = ctx.config.get("SAMPLE_GREETING", "Hello");
    const count = ((await ctx.state.get<number>("greet_count")) || 0) + 1;
    await ctx.state.set("greet_count", count);

    ctx.log.info(\`Greeting \${input.name} (times greeted: \${count})\`);

    return {
      message: \`\${greeting}, \${input.name}!\`,
      timestamp: new Date().toISOString(),
    };
  },
});
`;
  writeFileSync(join(actionsDir, "greet.ts"), sampleAction);

  // 6. playbooks/
  const playbooksDir = join(root, "playbooks");
  mkdirSync(playbooksDir, { recursive: true });

  const samplePlaybook = `---
id: greet-user
description: SOP for greeting a new user and verifying system health
actions:
  - sample.greet
---

# Greeting SOP

- Call \`sample.greet\` with the user's name.
- Confirm the returned greeting message.
`;
  writeFileSync(join(playbooksDir, "greet-user.md"), samplePlaybook);

  // 7. tests/
  const testsDir = join(root, "tests");
  mkdirSync(testsDir, { recursive: true });

  const sampleTest = `import { describe, expect, it } from "bun:test";
import { createTestRuntime } from "@actiondock/sdk";
import greetAction from "../actions/greet";

describe("greet action", () => {
  it("should greet user with greeting and increment count", async () => {
    const runtime = createTestRuntime({
      config: { SAMPLE_GREETING: "Hi" },
    });

    const res1 = await runtime.run(greetAction, { name: "Alice" });
    expect(res1.message).toBe("Hi, Alice!");
    expect(await runtime.state.get("greet_count")).toBe(1);

    const res2 = await runtime.run(greetAction, { name: "Bob" });
    expect(res2.message).toBe("Hi, Bob!");
    expect(await runtime.state.get("greet_count")).toBe(2);
  });
});
`;
  writeFileSync(join(testsDir, "greet.test.ts"), sampleTest);
}
