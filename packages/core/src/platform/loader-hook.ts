import { statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * 判断指定文件路径是否存在且为常规物理文件。
 * 使用 throwIfNoEntry: false 避免 ENOENT 抛错开销，保持微秒级解析性能。
 */
function isPhysicalFile(filePath: string): boolean {
  try {
    const stat = statSync(filePath, { throwIfNoEntry: false });
    return stat !== undefined && stat.isFile();
  } catch {
    return false;
  }
}

/**
 * 判断指定路径是否为物理目录。
 */
function isDirectory(filePath: string): boolean {
  try {
    const stat = statSync(filePath, { throwIfNoEntry: false });
    return stat !== undefined && stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 标准 ESM 解析上下文接口。
 */
export interface ResolveContext {
  conditions: string[];
  parentURL?: string;
  importAttributes?: Record<string, string>;
}

/**
 * 标准 ESM nextResolve 函数契约。
 */
export type NextResolve = (
  specifier: string,
  context?: ResolveContext
) => Promise<{
  format?: string | null;
  shortCircuit?: boolean;
  url: string;
}>;

/**
 * 全链路 ESM 路径重映射解析钩子。
 * 遵循 TypeScript NodeNext 模块规范与 Node.js 官方标准钩子协议：
 * - 仅拦截处于 file: 上下文中的相对路径导入（./、../、.、..）；
 * - 当目标请求路径在物理磁盘上不存在或为目录时：
 *   - 若以 .js 结尾，自动探测是否存在同名 .ts 或 .tsx；若存在，重定向返回；
 *   - 若以 .mjs 结尾，自动探测是否存在同名 .mts；若存在，重定向返回；
 *   - 若以 .cjs 结尾，自动探测是否存在同名 .cts；若存在，重定向返回；
 *   - 若无扩展名或为目录，自动探测补全 .ts、.tsx、.js、.mjs 以及目录 index 文件；
 * - 针对已存在物理实体文件或非相对导入，全面透传 nextResolve。
 */
export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
) {
  const { parentURL } = context;

  const isRelative =
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === "..";

  if (isRelative && typeof parentURL === "string" && parentURL.startsWith("file:")) {
    let targetUrl: URL;
    try {
      targetUrl = new URL(specifier, parentURL);
    } catch {
      return nextResolve(specifier, context);
    }

    const targetPath = fileURLToPath(targetUrl);

    // 目标已存在且为常规文件，直接透传原生解析流程
    if (isPhysicalFile(targetPath)) {
      return nextResolve(specifier, context);
    }

    const isDir = isDirectory(targetPath);
    const ext = extname(targetPath);
    const candidates: string[] = [];

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
