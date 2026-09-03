import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const rootDir = resolve(__dirname, "..");
const packages = ["sdk", "core", "mcp", "cli"] as const;

console.log("🚀 Starting ActionDock Pack Smoke Test...");

// 1. Pack all packages
const tarballPaths: Record<string, string> = {};

try {
  for (const pkg of packages) {
    const pkgDir = join(rootDir, "packages", pkg);
    console.log(`📦 Packing @actiondock/${pkg}...`);
    
    const packProc = Bun.spawnSync(["bun", "pm", "pack"], {
      cwd: pkgDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (packProc.exitCode !== 0) {
      throw new Error(`Failed to pack @actiondock/${pkg}: ${packProc.stderr.toString()}`);
    }

    const output = packProc.stdout.toString() + packProc.stderr.toString();
    const tgzMatch = output.match(/actiondock-[a-z0-9\-\.]+\.tgz/i);
    const tgzFilename = tgzMatch ? tgzMatch[0] : `actiondock-${pkg}-2.0.1.tgz`;
    const tgzPath = join(pkgDir, tgzFilename);

    if (!existsSync(tgzPath)) {
      throw new Error(`Expected tarball not found at: ${tgzPath}`);
    }

    tarballPaths[pkg] = tgzPath;
    console.log(`   ✓ Created ${tgzFilename} (${(Bun.file(tgzPath).size / 1024).toFixed(2)} KB)`);
  }

  // 2. Create clean temporary directory
  const testDir = mkdtempSync(join(tmpdir(), "actiondock-pack-smoke-"));
  console.log(`🧪 Testing in isolated temporary environment: ${testDir}`);

  // 3. Write test package.json with overrides pointing to packed tgz files
  const testPkgJson = {
    name: "actiondock-pack-smoke-test",
    version: "1.0.0",
    type: "module",
    dependencies: {
      "@actiondock/sdk": `file:${tarballPaths.sdk}`,
      "@actiondock/core": `file:${tarballPaths.core}`,
      "@actiondock/mcp": `file:${tarballPaths.mcp}`,
      "@actiondock/cli": `file:${tarballPaths.cli}`,
    },
    overrides: {
      "@actiondock/sdk": `file:${tarballPaths.sdk}`,
      "@actiondock/core": `file:${tarballPaths.core}`,
      "@actiondock/mcp": `file:${tarballPaths.mcp}`,
    },
  };

  writeFileSync(join(testDir, "package.json"), JSON.stringify(testPkgJson, null, 2));

  // 4. Run bun install in clean directory
  console.log("📥 Installing packed tarballs into test environment...");
  const installProc = Bun.spawnSync(["bun", "install"], {
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (installProc.exitCode !== 0) {
    throw new Error(`bun install failed: ${installProc.stderr.toString()}`);
  }
  console.log("   ✓ Dependencies installed cleanly");

  // 5. Test SDK & Core imports and functionality
  console.log("🔍 Testing SDK, Core, and MCP module imports and runtime execution...");
  const testScriptContent = `
import { defineAction, createTestRuntime } from "@actiondock/sdk";
import { ActionRunner } from "@actiondock/core";
import { createActionDockMcpServer, toMcpResult } from "@actiondock/mcp";

// 1. SDK verification
const greetAction = defineAction({
  id: "test.greet",
  description: "Test action in packed tgz",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  async run(input, ctx) {
    const greeting = ctx.config.get("GREETING", "Hello");
    const count = ((await ctx.state.get("count")) || 0) + 1;
    await ctx.state.set("count", count);
    return { message: greeting + ", " + input.name + "!", count };
  },
});

const runtime = createTestRuntime({
  config: { GREETING: "Welcome" },
  state: { count: 41 },
});

const res = await runtime.run(greetAction, { name: "ActionDock" });
if (res.message !== "Welcome, ActionDock!" || res.count !== 42) {
  throw new Error("SDK action run failed: " + JSON.stringify(res));
}
if ((await runtime.state.get("count")) !== 42) {
  throw new Error("State store update failed");
}

console.log("   ✓ SDK defineAction & TestRuntime verified");

// 2. Core verification
if (typeof ActionRunner !== "function") {
  throw new Error("ActionRunner export missing from @actiondock/core");
}
console.log("   ✓ Core ActionRunner export verified");

// 3. MCP verification
if (typeof createActionDockMcpServer !== "function" || typeof toMcpResult !== "function") {
  throw new Error("createActionDockMcpServer export missing from @actiondock/mcp");
}
console.log("   ✓ MCP createActionDockMcpServer & toMcpResult export verified");
`;

  writeFileSync(join(testDir, "test-runtime.mjs"), testScriptContent);

  const nodeProc = Bun.spawnSync(["bun", "test-runtime.mjs"], {
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (nodeProc.exitCode !== 0) {
    throw new Error(`Runtime smoke test script failed:\n${nodeProc.stderr.toString()}\n${nodeProc.stdout.toString()}`);
  }
  console.log(nodeProc.stdout.toString().trimEnd());

  // 6. Test CLI executable in node_modules/.bin
  console.log("⚙️  Testing CLI executable in node_modules/.bin/ad...");
  const cliBin = join(testDir, "node_modules", ".bin", "ad");
  if (!existsSync(cliBin)) {
    throw new Error(`CLI executable not found at: ${cliBin}`);
  }

  // ad --version
  const verProc = Bun.spawnSync([cliBin, "--version"], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
  if (verProc.exitCode !== 0 || !verProc.stdout.toString().includes("2.0.1")) {
    throw new Error(`'ad --version' failed: ${verProc.stderr.toString()} (output: ${verProc.stdout.toString()})`);
  }
  console.log(`   ✓ ad --version returned 2.0.1`);

  // ad --help
  const helpProc = Bun.spawnSync([cliBin, "--help"], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
  if (helpProc.exitCode !== 0 || !helpProc.stdout.toString().includes("ActionDock (ad) 2.0")) {
    throw new Error(`'ad --help' failed: ${helpProc.stderr.toString()}`);
  }
  console.log(`   ✓ ad --help verified`);

  // ad doctor --json
  const docProc = Bun.spawnSync([cliBin, "doctor", "--json"], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
  if (docProc.exitCode !== 0) {
    throw new Error(`'ad doctor --json' failed: ${docProc.stderr.toString()}`);
  }
  const docJson = JSON.parse(docProc.stdout.toString());
  if (!docJson.summary || docJson.summary.errorCount > 0) {
    throw new Error(`'ad doctor' reported unexpected errors: ${JSON.stringify(docJson.summary)}`);
  }
  console.log(`   ✓ ad doctor passed with 0 errors`);

  // Cleanup testDir
  rmSync(testDir, { recursive: true, force: true });
  console.log("🧹 Cleaned up temporary test environment");

  console.log("\n🎉 All Pack Smoke Tests Passed Successfully!");
} finally {
  // Always remove generated tarball files
  for (const tgz of Object.values(tarballPaths)) {
    if (existsSync(tgz)) {
      rmSync(tgz, { force: true });
    }
  }
}
