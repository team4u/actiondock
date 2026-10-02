import { statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function isPhysicalFile(filePath) {
  try {
    const stat = statSync(filePath, { throwIfNoEntry: false });
    return stat !== undefined && stat.isFile();
  } catch {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    const stat = statSync(filePath, { throwIfNoEntry: false });
    return stat !== undefined && stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 全链路 ESM 路径重映射解析钩子（ES 模块原生导出）。
 */
export async function resolve(specifier, context, nextResolve) {
  const { parentURL } = context;

  const isRelative =
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === "..";

  if (isRelative && typeof parentURL === "string" && parentURL.startsWith("file:")) {
    let targetUrl;
    try {
      targetUrl = new URL(specifier, parentURL);
    } catch {
      return nextResolve(specifier, context);
    }

    const targetPath = fileURLToPath(targetUrl);

    if (isPhysicalFile(targetPath)) {
      return nextResolve(specifier, context);
    }

    const isDir = isDirectory(targetPath);
    const ext = extname(targetPath);
    const candidates = [];

    if (ext === ".js") {
      const base = targetPath.slice(0, -3);
      candidates.push(base + ".ts", base + ".tsx");
    } else if (ext === ".mjs") {
      const base = targetPath.slice(0, -4);
      candidates.push(base + ".mts");
    } else if (ext === ".cjs") {
      const base = targetPath.slice(0, -4);
      candidates.push(base + ".cts");
    } else if (!ext || isDir) {
      if (!isDir) {
        candidates.push(
          targetPath + ".ts",
          targetPath + ".tsx",
          targetPath + ".js",
          targetPath + ".mjs"
        );
      }
      candidates.push(
        join(targetPath, "index.ts"),
        join(targetPath, "index.tsx"),
        join(targetPath, "index.js"),
        join(targetPath, "index.mjs")
      );
    }

    for (const candidate of candidates) {
      if (isPhysicalFile(candidate)) {
        const candidateUrl = pathToFileURL(candidate);
        candidateUrl.search = targetUrl.search;
        candidateUrl.hash = targetUrl.hash;
        return nextResolve(candidateUrl.href, context);
      }
    }
  }

  return nextResolve(specifier, context);
}
