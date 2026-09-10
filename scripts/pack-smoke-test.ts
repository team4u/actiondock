import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");
const rootPkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const currentVersion = rootPkg.version;

const packages = [
  "sdk",
  "core",
  "mcp",
  "builder",
  "runtime-node",
  "cli",
  "testing",
] as const;

console.log("[START] Starting ActionDock Pack Smoke Test...");

// Build all packages before packaging
console.log("[BUILD] Building all packages via build script...");
const preBuild = spawnSync(process.execPath, [join(rootDir, "scripts", "build.ts")], {
  cwd: rootDir,
  stdio: "inherit",
});
if (preBuild.status !== 0) {
  throw new Error("Pre-pack build failed with non-zero exit code");
}

const tarballPaths: Record<string, string> = {};

try {
  // Pack each package
  for (const pkg of packages) {
    const pkgDir = join(rootDir, "packages", pkg);
    console.log(`[PACK] Packing @actiondock/${pkg}...`);

    const packProc = spawnSync("npm", ["pack"], {
      cwd: pkgDir,
      encoding: "utf8",
    });

    if (packProc.status !== 0) {
      throw new Error(`Failed to pack @actiondock/${pkg}: ${packProc.stderr}`);
    }

    const lines = packProc.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const tgzFilename = lines[lines.length - 1];
    const tgzPath = join(pkgDir, tgzFilename);

    if (!existsSync(tgzPath)) {
      throw new Error(`Expected tarball not found at: ${tgzPath}`);
    }

    tarballPaths[pkg] = tgzPath;
    console.log(`[OK] Created ${tgzFilename}`);
  }

  // Verify that built packages do not embed other packages/*/src
  console.log("[VERIFY] Checking dist files for embedded workspace source boundaries...");
  for (const pkg of packages) {
    if (pkg === "core") continue;
    const pkgDist = join(rootDir, "packages", pkg, "dist");
    if (existsSync(pkgDist)) {
      const scanFiles = (dir: string): string[] => {
        const list: string[] = [];
        for (const e of readdirSync(dir)) {
          const full = join(dir, e);
          if (statSync(full).isDirectory()) list.push(...scanFiles(full));
          else if (full.endsWith(".js")) list.push(full);
        }
        return list;
      };
      for (const jsFile of scanFiles(pkgDist)) {
        const text = readFileSync(jsFile, "utf-8");
        if (text.includes("packages/core/src")) {
          throw new Error(`Package boundary failure: @actiondock/${pkg} embeds packages/core/src in ${jsFile}`);
        }
      }
    }
  }
  console.log("[OK] Package boundaries verified: no dist embeds packages/*/src");

  // Create clean temporary directory
  const testDir = mkdtempSync(join(tmpdir(), "actiondock-pack-smoke-"));
  console.log(`[TEST] Testing in isolated temporary environment: ${testDir}`);

  // Write test package.json with dependencies and overrides pointing to packed tgz files
  const testPkgJson = {
    name: "actiondock-pack-smoke-test",
    version: "1.0.0",
    type: "module",
    dependencies: {
      "@actiondock/sdk": `file:${tarballPaths.sdk}`,
      "@actiondock/core": `file:${tarballPaths.core}`,
      "@actiondock/mcp": `file:${tarballPaths.mcp}`,
      "@actiondock/builder": `file:${tarballPaths.builder}`,
      "@actiondock/runtime-node": `file:${tarballPaths["runtime-node"]}`,
      "@actiondock/cli": `file:${tarballPaths.cli}`,
      "@actiondock/testing": `file:${tarballPaths.testing}`,
    },
    overrides: {
      "@actiondock/sdk": `file:${tarballPaths.sdk}`,
      "@actiondock/core": `file:${tarballPaths.core}`,
      "@actiondock/mcp": `file:${tarballPaths.mcp}`,
      "@actiondock/builder": `file:${tarballPaths.builder}`,
      "@actiondock/runtime-node": `file:${tarballPaths["runtime-node"]}`,
      "@actiondock/cli": `file:${tarballPaths.cli}`,
      "@actiondock/testing": `file:${tarballPaths.testing}`,
    },
  };

  writeFileSync(join(testDir, "package.json"), JSON.stringify(testPkgJson, null, 2));

  // Install packed tarballs into test environment
  console.log("[INSTALL] Installing packed tarballs into test environment...");
  const installProc = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: testDir,
    encoding: "utf8",
  });

  if (installProc.status !== 0) {
    throw new Error(`Dependency installation failed: ${installProc.stderr}`);
  }
  console.log("[OK] Dependencies installed cleanly");

  // Write Node.js test script covering all 7 packages
  console.log("[TEST] Testing module imports and runtime execution via native Node.js...");
  const testScriptContent = `
import { defineAction } from "@actiondock/sdk";
import { ActionRunner, ExecutionService, SqliteRuntimeStorage, createStorage, ACTIONDOCK_VERSION } from "@actiondock/core";
import { createActionDockMcpServer, toMcpResult } from "@actiondock/mcp";
import { BuildPlanner, SkillExporter, buildProject } from "@actiondock/builder";
import { createNodePlatform, NodeSqliteDriver, NodeHttpServer } from "@actiondock/runtime-node";
import { main, createCliProgram, formatError, runStandaloneCli } from "@actiondock/cli";
import { FakeClock, MemoryStorage, createTestRuntime } from "@actiondock/testing";

// Verify SDK
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
console.log("[OK] SDK defineAction and createTestRuntime verified");

// Verify Core
if (typeof ActionRunner !== "function" || typeof ExecutionService !== "function") {
  throw new Error("Core exports missing ActionRunner or ExecutionService");
}
if (ACTIONDOCK_VERSION !== "${currentVersion}") {
  throw new Error("Core ACTIONDOCK_VERSION mismatch: " + ACTIONDOCK_VERSION);
}
console.log("[OK] Core ActionRunner, ExecutionService, and version verified");

// Verify MCP
if (typeof createActionDockMcpServer !== "function" || typeof toMcpResult !== "function") {
  throw new Error("MCP exports missing createActionDockMcpServer or toMcpResult");
}
console.log("[OK] MCP createActionDockMcpServer and toMcpResult verified");

// Verify Builder
if (typeof BuildPlanner?.plan !== "function" || typeof SkillExporter?.export !== "function" || typeof buildProject !== "function") {
  throw new Error("Builder exports missing BuildPlanner, SkillExporter, or buildProject");
}
console.log("[OK] Builder BuildPlanner, SkillExporter, and buildProject verified");

// Verify Runtime Node
if (typeof createNodePlatform !== "function" || typeof NodeSqliteDriver !== "function" || typeof NodeHttpServer !== "function") {
  throw new Error("Runtime Node exports missing key components");
}
console.log("[OK] Runtime Node createNodePlatform, NodeSqliteDriver, and NodeHttpServer verified");

// Verify CLI
if (typeof main !== "function" || typeof createCliProgram !== "function" || typeof formatError !== "function" || typeof runStandaloneCli !== "function") {
  throw new Error("CLI exports missing main, createCliProgram, formatError, or runStandaloneCli");
}
console.log("[OK] CLI main, createCliProgram, formatError, and runStandaloneCli verified");

// Verify Testing
if (typeof FakeClock !== "function" || typeof MemoryStorage !== "function" || typeof createTestRuntime !== "function") {
  throw new Error("Testing exports missing FakeClock, MemoryStorage, or createTestRuntime");
}
console.log("[OK] Testing FakeClock, MemoryStorage, and createTestRuntime verified");

// Verify Core Execution Service with Node Platform
const nodePlatform = createNodePlatform();
const nodeStorage = nodePlatform.storage.createStorage("smoke-test-pkg", { inMemory: true });
const execService = new ExecutionService({
  packageId: "smoke-test-pkg",
  platform: nodePlatform,
  storage: nodeStorage,
  actionResolver: (ref) => {
    const actionId = typeof ref === "string" ? ref : ref.actionId;
    if (actionId === "smoke.action") {
      return {
        id: "smoke.action",
        description: "Smoke action",
        inputSchema: { type: "object" },
        run: async () => ({ result: "node-execution-success" }),
      };
    }
    return undefined;
  },
});

const execResult = await execService.execute("smoke.action", {});
if (!execResult.ok || execResult.data?.result !== "node-execution-success") {
  throw new Error("Native Node execution service run failed: " + JSON.stringify(execResult));
}
const runs = await nodeStorage.listRuns();
if (runs.length === 0 || runs[0].id !== execResult.runId || runs[0].status !== "success") {
  throw new Error("Native Node storage run record missing or mismatched: " + JSON.stringify(runs));
}
await execService.close();
await nodeStorage.close();
console.log("[OK] Core ExecutionService with NodeSqliteDriver executed and verified");
process.exit(0);
`;

  writeFileSync(join(testDir, "test-runtime.mjs"), testScriptContent);

  // Execute test-runtime.mjs with native Node
  const nodeProc = spawnSync("node", ["test-runtime.mjs"], {
    cwd: testDir,
    encoding: "utf8",
    timeout: 60000,
  });

  if (nodeProc.status !== 0) {
    throw new Error(`Native Node smoke test script failed:\n${nodeProc.stderr}\n${nodeProc.stdout}`);
  }
  console.log(nodeProc.stdout.trimEnd());

  // Test CLI executable in node_modules/.bin/ad using native Node
  console.log("[TEST] Testing CLI executable in node_modules/.bin/ad via native Node...");
  const cliBin = join(testDir, "node_modules", ".bin", "ad");
  if (!existsSync(cliBin)) {
    throw new Error(`CLI executable not found at: ${cliBin}`);
  }

  // ad --version
  const verProc = spawnSync("node", [cliBin, "--version"], { cwd: testDir, encoding: "utf8" });
  if (verProc.status !== 0 || !verProc.stdout.includes(currentVersion)) {
    throw new Error(`'node ad --version' failed: ${verProc.stderr} (output: ${verProc.stdout})`);
  }
  console.log(`[OK] node ad --version returned ${currentVersion}`);

  // ad --help
  const helpProc = spawnSync("node", [cliBin, "--help"], { cwd: testDir, encoding: "utf8" });
  if (helpProc.status !== 0 || !helpProc.stdout.includes("ActionDock (ad) 2.0")) {
    throw new Error(`'node ad --help' failed: ${helpProc.stderr}`);
  }
  console.log("[OK] node ad --help verified");

  // ad doctor --json
  const docProc = spawnSync("node", [cliBin, "doctor", "--json"], { cwd: testDir, encoding: "utf8" });
  if (docProc.status !== 0) {
    throw new Error(`'node ad doctor --json' failed: ${docProc.stderr}`);
  }
  const docJson = JSON.parse(docProc.stdout);
  if (!docJson.summary || docJson.summary.errorCount > 0) {
    throw new Error(`'ad doctor' reported unexpected errors: ${JSON.stringify(docJson.summary)}`);
  }
  console.log("[OK] node ad doctor passed with 0 errors");

  // Cleanup testDir
  rmSync(testDir, { recursive: true, force: true });
  console.log("[CLEANUP] Cleaned up temporary test environment");

  console.log(`\n[SUCCESS] All Pack Smoke Tests Passed Successfully Across All ${packages.length} Packages!`);
} finally {
  // Always remove generated tarball files
  for (const tgz of Object.values(tarballPaths)) {
    if (existsSync(tgz)) {
      rmSync(tgz, { force: true });
    }
  }
}
