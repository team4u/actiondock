import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");
const tscBin = join(rootDir, "node_modules", "typescript", "bin", "tsc");

interface PackageMeta {
  name: string;
  shortName: string;
  dir: string;
  dependencies: string[];
}

function discoverPackages(): PackageMeta[] {
  const rootPkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
  const workspaces: string[] = rootPkg.workspaces || ["packages/*"];
  const packages: PackageMeta[] = [];

  for (const pattern of workspaces) {
    if (pattern.endsWith("/*")) {
      const baseDir = join(rootDir, pattern.slice(0, -2));
      if (!existsSync(baseDir)) continue;
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pkgDir = join(baseDir, entry.name);
        const pkgJsonPath = join(pkgDir, "package.json");
        if (existsSync(pkgJsonPath)) {
          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          if (pkgJson.name && pkgJson.name.startsWith("@actiondock/")) {
            const deps = Object.keys(pkgJson.dependencies || {}).filter((d) => d.startsWith("@actiondock/"));
            packages.push({
              name: pkgJson.name,
              shortName: entry.name,
              dir: pkgDir,
              dependencies: deps,
            });
          }
        }
      }
    }
  }
  return packages;
}

function topologicalSort(packages: PackageMeta[]): PackageMeta[] {
  const packageMap = new Map<string, PackageMeta>(packages.map((p) => [p.name, p]));
  const visited = new Set<string>();
  const sorted: PackageMeta[] = [];

  function visit(pkgName: string, path: Set<string>) {
    if (path.has(pkgName)) {
      throw new Error(`Circular dependency detected: ${Array.from(path).join(" -> ")} -> ${pkgName}`);
    }
    if (visited.has(pkgName)) return;
    path.add(pkgName);
    const pkg = packageMap.get(pkgName);
    if (pkg) {
      for (const dep of pkg.dependencies) {
        if (packageMap.has(dep)) {
          visit(dep, new Set(path));
        }
      }
      visited.add(pkgName);
      sorted.push(pkg);
    }
    path.delete(pkgName);
  }

  for (const pkg of packages) {
    if (!visited.has(pkg.name)) {
      visit(pkg.name, new Set());
    }
  }

  return sorted;
}

function rewriteDistImports(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteDistImports(full);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
      let code = readFileSync(full, "utf-8");

      // Rewrite static `from "./foo"` / `export from "./foo"`
      code = code.replace(
        /((?:import|export)\s+[\s\S]*?from\s+["\'])(\.\.?\/[^"\']+)(["\'])/g,
        (_m, prefix, relPath, suffix) => {
          if (relPath.endsWith(".js") || relPath.endsWith(".json")) return _m;
          const target = resolve(dir, relPath);
          if (existsSync(target) && statSync(target).isDirectory()) {
            return `${prefix}${relPath}/index.js${suffix}`;
          }
          return `${prefix}${relPath}.js${suffix}`;
        }
      );

      // Rewrite side-effect `import "./foo"`
      code = code.replace(
        /(import\s+["\'])(\.\.?\/[^"\']+)(["\'])/g,
        (_m, prefix, relPath, suffix) => {
          if (relPath.endsWith(".js") || relPath.endsWith(".json")) return _m;
          const target = resolve(dir, relPath);
          if (existsSync(target) && statSync(target).isDirectory()) {
            return `${prefix}${relPath}/index.js${suffix}`;
          }
          return `${prefix}${relPath}.js${suffix}`;
        }
      );

      // Rewrite dynamic `import("./foo")`
      code = code.replace(
        /(import\s*\(\s*["\'])(\.\.?\/[^"\']+)(["\']\s*\))/g,
        (_m, prefix, relPath, suffix) => {
          if (relPath.endsWith(".js") || relPath.endsWith(".json")) return _m;
          const target = resolve(dir, relPath);
          if (existsSync(target) && statSync(target).isDirectory()) {
            return `${prefix}${relPath}/index.js${suffix}`;
          }
          return `${prefix}${relPath}.js${suffix}`;
        }
      );

      writeFileSync(full, code, "utf-8");
    }
  }
}

function buildAll(): void {
  const discovered = discoverPackages();
  const sortedPackages = topologicalSort(discovered);

  console.log(`[BUILD] Discovered and topologically sorted ${sortedPackages.length} packages:`);
  for (const p of sortedPackages) {
    console.log(` - ${p.name}`);
  }

  for (const pkg of sortedPackages) {
    const distDir = join(pkg.dir, "dist");
    if (existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
    }
    mkdirSync(distDir, { recursive: true });

    console.log(`[BUILD] Compiling ${pkg.name}...`);
    const tsconfigPath = join(pkg.dir, "tsconfig.json");
    const tscProc = spawnSync(process.execPath, [tscBin, "-p", tsconfigPath], {
      cwd: rootDir,
      stdio: "inherit",
    });

    if (tscProc.status !== 0) {
      console.error(`[ERROR] Failed to compile ${pkg.name}`);
      process.exit(1);
    }

    rewriteDistImports(distDir);
    console.log(`[OK] Built ${pkg.name}`);
  }

  // Verification
  let failed = false;
  for (const pkg of sortedPackages) {
    const jsPath = join(pkg.dir, "dist", "index.js");
    const dtsPath = join(pkg.dir, "dist", "index.d.ts");

    if (!existsSync(jsPath)) {
      console.error(`[ERROR] Missing dist/index.js in ${pkg.name}`);
      failed = true;
    }
    if (!existsSync(dtsPath)) {
      console.error(`[ERROR] Missing dist/index.d.ts in ${pkg.name}`);
      failed = true;
    }

    if (pkg.shortName !== "core" && existsSync(jsPath)) {
      const content = readFileSync(jsPath, "utf-8");
      if (content.includes("packages/core/src")) {
        console.error(`[ERROR] Package ${pkg.name} dist embedded packages/core/src!`);
        failed = true;
      }
    }
  }

  if (failed) {
    process.exit(1);
  }

  console.log(`[SUCCESS] All ${sortedPackages.length} ActionDock packages built successfully!`);
}

buildAll();
