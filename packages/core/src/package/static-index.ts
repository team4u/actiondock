import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ActionDefinition } from "@actiondock/sdk";
import { loadPlaybooks } from "../project/loader";
import { loadManifest, MANIFEST_FILE_NAME } from "../project/manifest";
import type { ProjectConfig } from "../project/types";
import type { ActionSpec, PlaybookSpec } from "./types";

/**
 * 静态清单索引构建入参：同一包的全部静态事实来源。
 * 入参不可变（同实例内复用解析结果的前提），字段与 App 实例的运行时只读状态一一对应。
 */
export interface StaticIndexInput {
  /** 包根目录（磁盘清单来源；缺省时仅聚合配置与内存注入来源） */
  packageRoot?: string;
  /** 包唯一标识 */
  packageId: string;
  /** 项目配置（Manifest v2 声明来源） */
  projectConfig: ProjectConfig;
}

/** Action 索引构建入参：静态事实来源之上叠加内存注入的 Action 定义集合 */
export interface StaticActionIndexInput extends StaticIndexInput {
  /** 内存显式注入的 Action 定义集合 */
  actionsMap: ReadonlyMap<string, ActionDefinition>;
}

/**
 * 字段级合并覆盖策略：不同来源对同名字段的覆盖语义存在差异。
 *
 * - 常规字段（description 等）：声明值优先，缺省回退既有值；
 * - 数组字段（tags/uses）：声明值存在时可选拷贝新数组，避免与来源对象共享引用；
 * - 派生字段（filePath）：由声明 entry 与包根目录计算，声明缺失时回退既有值。
 */
interface MergeFieldPolicy {
  /** 数组字段：声明值存在时拷贝副本（磁盘清单与内存注入层启用，配置声明层直传引用） */
  arrayCopy?: boolean;
  /** 数组字段列表 */
  arrayFields?: Array<"tags" | "uses">;
  /** 派生字段：是否依据声明 entry 计算物理路径 */
  deriveFilePath?: boolean;
  /** 保留既有值：声明无对应字段时保留既有 entry 与 filePath */
  preserveEntry?: boolean;
}

/**
 * 将增量声明合并到既有 Action 规范之上（纯函数，单一事实源）。
 *
 * 优先级语义由调用顺序表达：后层调用时以先层结果作为 base，
 * 声明值（patch）存在时覆盖，缺省字段回退 base 既有值。
 */
function mergeSpec(
  base: ActionSpec | undefined,
  id: string,
  packageId: string,
  patch: {
    description?: string;
    inputSchema?: ActionSpec["inputSchema"];
    outputSchema?: ActionSpec["outputSchema"];
    tags?: string[];
    annotations?: Record<string, unknown>;
    uses?: string[];
    entry?: string;
  },
  packageRoot: string | undefined,
  policy: MergeFieldPolicy = {}
): ActionSpec {
  const { arrayCopy = true, arrayFields = [], deriveFilePath = false, preserveEntry = false } = policy;
  const merged: ActionSpec = {
    id,
    packageId,
    description: patch.description ?? base?.description,
    inputSchema: patch.inputSchema ?? base?.inputSchema,
    outputSchema: patch.outputSchema ?? base?.outputSchema,
    annotations: patch.annotations ?? base?.annotations,
  };
  for (const field of arrayFields) {
    merged[field] = patch[field]
      ? (arrayCopy ? [...patch[field]!] : patch[field])
      : base?.[field];
  }
  if (deriveFilePath) {
    merged.entry = patch.entry ?? base?.entry;
    merged.filePath =
      patch.entry && packageRoot
        ? resolve(packageRoot, patch.entry)
        : base?.filePath;
  } else if (preserveEntry) {
    merged.entry = base?.entry;
    merged.filePath = base?.filePath;
  } else {
    merged.entry = patch.entry ?? base?.entry;
    merged.filePath = base?.filePath;
  }
  return merged;
}

/**
 * 静态读取并聚合指定包的 Action 规范索引。
 * 不产生全量模块导入与执行副作用。
 *
 * 聚合优先级（后者覆盖前者同名字段，缺省字段回退前者）：
 * - 磁盘声明式清单文件（actiondock.json）；
 * - 项目配置中声明的 actions（Manifest v2 格式）；
 * - 内存显式注入的 Action 定义。
 *
 * 清单文件不存在属于合法空态；解析失败（损坏 JSON 等）输出告警并跳过清单部分。
 */
export function buildStaticActionMap(input: StaticActionIndexInput): Map<string, ActionSpec> {
  const { packageRoot, packageId, projectConfig, actionsMap } = input;
  const map = new Map<string, ActionSpec>();

  // 读取声明式清单文件 (actiondock.json)
  if (packageRoot) {
    const manifestPath = join(packageRoot, MANIFEST_FILE_NAME);
    // 文件不存在属于合法空态（无清单包）；解析失败（损坏 JSON 等）则输出告警并跳过清单部分
    if (!existsSync(manifestPath)) {
      // 合法空态：无清单文件，仅依赖后续配置与内存注入来源
    } else {
      try {
        const manifest = loadManifest(packageRoot);
        if (manifest?.actions) {
          for (const [id, item] of Object.entries(manifest.actions)) {
            // 磁盘清单为最底层来源：无更低层可回退，tags 与 uses 缺省时归一为空数组
            map.set(
              id,
              mergeSpec(undefined, id, packageId, {
                ...item,
                tags: item.tags ?? [],
                uses: item.uses ?? [],
              }, packageRoot, {
                arrayFields: ["tags", "uses"],
                deriveFilePath: true,
              })
            );
          }
        }
      } catch (err: any) {
        console.warn(
          `[App] Failed to load manifest for package '${packageId}' from '${manifestPath}': ${err?.message || String(err)}`
        );
      }
    }
  }

  // 读取项目配置文件中声明的 actions (Manifest v2 格式)
  if (projectConfig && projectConfig.actions) {
    const rawActions = projectConfig.actions;
    if (typeof rawActions === "object" && rawActions !== null) {
      for (const [id, item] of Object.entries(rawActions as Record<string, any>)) {
        // 配置声明层：覆盖磁盘清单层，entry 变化时重算物理路径；数组字段直传引用
        map.set(
          id,
          mergeSpec(map.get(id), id, packageId, item, packageRoot, {
            arrayFields: ["tags", "uses"],
            arrayCopy: false,
            deriveFilePath: true,
          })
        );
      }
    }
  }

  // 读取内存显式注入的 Action 定义
  for (const [id, act] of actionsMap) {
    // 若为当前包完全限定名别名（例如 "pkgId/actionId"），跳过以防与短名 action 重复
    if (id.startsWith(`${packageId}/`)) {
      const shortId = id.slice(packageId.length + 1);
      if (actionsMap.has(shortId) || map.has(shortId)) {
        continue;
      }
    }
    // 内存注入层：保留磁盘层解析出的 entry 与 filePath，仅覆盖动态定义相关字段
    map.set(
      id,
      mergeSpec(map.get(id), id, packageId, act as any, packageRoot, {
        arrayFields: ["tags", "uses"],
        preserveEntry: true,
      })
    );
  }

  return map;
}

/**
 * 静态读取并聚合指定包的 Playbook 规范索引。
 *
 * 聚合来源：磁盘规程目录扫描（以 actiondock.json 声明为事实源）与
 * 项目配置中声明的 playbooks；同键时配置声明覆盖磁盘扫描结果。
 */
export function buildStaticPlaybookMap(input: StaticIndexInput): Map<string, PlaybookSpec> {
  const { packageRoot, packageId, projectConfig } = input;
  const map = new Map<string, PlaybookSpec>();

  // 扫描磁盘规程文件
  if (packageRoot) {
    const playbooksDir = projectConfig?.playbooksDir || "playbooks";
    const dirPath = join(packageRoot, playbooksDir);
    if (existsSync(dirPath)) {
      try {
        const loaded = loadPlaybooks(packageRoot, playbooksDir);
        for (const [id, def] of loaded) {
          map.set(id, {
            id: def.id,
            packageId,
            description: def.description,
            actions: def.actions,
            content: def.content,
            filePath: def.filePath,
          });
        }
      } catch (err: any) {
        // 规程加载失败（清单声明非法、规程文件损坏等）输出告警并跳过磁盘部分，保持返回可用列表
        console.warn(
          `[App] Failed to load playbooks for package '${packageId}' from '${dirPath}': ${err?.message || String(err)}`
        );
      }
    }
  }

  // 读取项目配置文件中的 playbooks
  if (projectConfig && projectConfig.playbooks) {
    const rawPlaybooks = projectConfig.playbooks;
    if (typeof rawPlaybooks === "object" && rawPlaybooks !== null) {
      for (const [id, item] of Object.entries(rawPlaybooks as Record<string, any>)) {
        const existing = map.get(id);
        let content = item.content ?? existing?.content ?? "";
        let filePath = item.entry && packageRoot
          ? resolve(packageRoot, item.entry)
          : existing?.filePath;

        if (!content && filePath && existsSync(filePath)) {
          try {
            content = readFileSync(filePath, "utf-8");
          } catch (err: any) {
            // 读取失败（权限、IO 错误等）输出告警并保持空正文，不再无声吞没
            console.warn(
              `[App] Failed to read playbook '${id}' content from '${filePath}' in package '${packageId}': ${err?.message || String(err)}`
            );
          }
        }

        map.set(id, {
          id,
          packageId,
          description: item.description ?? existing?.description,
          actions: item.actions ?? existing?.actions,
          content,
          filePath,
        });
      }
    }
  }

  return map;
}
