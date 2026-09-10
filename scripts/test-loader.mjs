import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "..");
const compatUrl = pathToFileURL(path.join(rootDir, "scripts", "test-compat.ts")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "bun:test") {
    return {
      shortCircuit: true,
      url: compatUrl,
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // 1. Check relative imports
    if (specifier.startsWith(".") && context.parentURL && context.parentURL.startsWith("file:")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const targetBase = path.resolve(parentDir, specifier);
      for (const ext of [".ts", ".js", ".mjs", "/index.ts", "/index.js", "/index.mjs"]) {
        const candidate = targetBase + ext;
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
          return await nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }

    // 2. Check @actiondock/* workspace aliases
    if (specifier.startsWith("@actiondock/")) {
      const pkgName = specifier.slice("@actiondock/".length);
      const candidates = [
        path.join(rootDir, "packages", pkgName, "src", "index.ts"),
        path.join(rootDir, "packages", pkgName, "dist", "index.js"),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return await nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }

    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const filePath = fileURLToPath(url);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      return {
        format: "json",
        shortCircuit: true,
        source: content,
      };
    }
  }

  const result = await nextLoad(url, context);
  if (url.startsWith("file:") && (url.endsWith(".ts") || url.endsWith(".js"))) {
    let source = typeof result.source === "string" ? result.source : result.source?.toString("utf8");
    if (source && source.includes("__dirname")) {
      source = source.replace(/\b__dirname\b/g, "import.meta.dirname");
      return {
        ...result,
        source,
      };
    }
  }
  return result;
}
