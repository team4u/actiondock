import { existsSync } from "node:fs";
import { loadProjectConfig } from "../../project/loader";
import { listLinkedPackages, resolvePackageRoot } from "../../registry/registry";
import type { RuntimeStorage } from "../../storage/types";
import type { RunRecord } from "@actiondock/sdk";
import type { ServerRuntimeRegistry } from "../runtime-registry";
import type { ServerOptions } from "../types";

/**
 * 路由处理统一上下文对象。
 */
export interface RouteContext {
  req: Request;
  url: URL;
  pathname: string;
  corsHeaders: Record<string, string>;
  projectRoot: string | null;
  customHome?: string;
  runtimeRegistry: ServerRuntimeRegistry;
  options: ServerOptions;
}

/**
 * 辅助函数：构造带 CORS 头的标准 JSON HTTP 响应。
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  corsHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

/**
 * 依据 package 参数或项目上下文解析目标 Storage 实例与根目录。
 */
export function resolveStorageForPackage(
  packageIdOrPath: string | undefined,
  runtimeRegistry: ServerRuntimeRegistry,
  projectRoot?: string | null,
  customHome?: string
): { packageId: string; storage: RuntimeStorage; projectRoot?: string } {
  if (packageIdOrPath) {
    const root = resolvePackageRoot(packageIdOrPath, customHome);
    if (root) {
      const config = loadProjectConfig(root);
      return {
        packageId: config.id,
        storage: runtimeRegistry.getStorage(config.id, root),
        projectRoot: root,
      };
    }
    return {
      packageId: packageIdOrPath,
      storage: runtimeRegistry.getStorage(packageIdOrPath),
    };
  }

  if (projectRoot) {
    const config = loadProjectConfig(projectRoot);
    return {
      packageId: config.id,
      storage: runtimeRegistry.getStorage(config.id, projectRoot),
      projectRoot,
    };
  }

  const linked = listLinkedPackages(customHome);
  if (linked.length > 0) {
    const first = linked[0];
    return {
      packageId: first.id,
      storage: runtimeRegistry.getStorage(first.id, first.path),
      projectRoot: first.path,
    };
  }

  return {
    packageId: "default",
    storage: runtimeRegistry.getStorage("default"),
  };
}

/**
 * 跨活跃连接与所有已知持久化存储全局检索指定 runId 的运行记录。
 */
export function findRunAcrossStorages(
  runId: string,
  runtimeRegistry: ServerRuntimeRegistry,
  projectRoot?: string | null,
  customHome?: string
): { storage: RuntimeStorage; run: RunRecord } | null {
  const inMemory = runtimeRegistry.findRun(runId);
  if (inMemory) return inMemory as { storage: RuntimeStorage; run: RunRecord };

  if (projectRoot) {
    try {
      const config = loadProjectConfig(projectRoot);
      const storage = runtimeRegistry.getStorage(config.id, projectRoot);
      const run = storage.getRun(runId);
      if (run) return { storage, run };
    } catch {
      // 忽略读取错误
    }
  }

  try {
    const linked = listLinkedPackages(customHome);
    for (const pkg of linked) {
      if (!existsSync(pkg.path)) continue;
      const storage = runtimeRegistry.getStorage(pkg.id, pkg.path);
      const run = storage.getRun(runId);
      if (run) return { storage, run };
    }
  } catch {
    // 忽略读取错误
  }

  return null;
}
