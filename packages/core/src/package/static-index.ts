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
            map.set(id, {
              id,
              packageId,
              description: item.description,
              inputSchema: item.inputSchema,
              outputSchema: item.outputSchema,
              tags: item.tags ? [...item.tags] : [],
              annotations: item.annotations,
              uses: item.uses ? [...item.uses] : [],
              entry: item.entry,
              filePath: item.entry ? resolve(packageRoot, item.entry) : undefined,
            });
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
        const existing = map.get(id);
        map.set(id, {
          id,
          packageId,
          description: item.description ?? existing?.description,
          inputSchema: item.inputSchema ?? existing?.inputSchema,
          outputSchema: item.outputSchema ?? existing?.outputSchema,
          tags: item.tags ?? existing?.tags,
          annotations: item.annotations ?? existing?.annotations,
          uses: item.uses ?? existing?.uses,
          entry: item.entry ?? existing?.entry,
          filePath: item.entry && packageRoot
            ? resolve(packageRoot, item.entry)
            : existing?.filePath,
        });
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
    const existing = map.get(id);
    const actObj = act as any;
    map.set(id, {
      id,
      packageId,
      description: actObj.description ?? existing?.description,
      inputSchema: actObj.inputSchema ?? existing?.inputSchema,
      outputSchema: actObj.outputSchema ?? existing?.outputSchema,
      tags: actObj.tags ? [...actObj.tags] : existing?.tags,
      annotations: actObj.annotations ?? existing?.annotations,
      uses: actObj.uses ? [...actObj.uses] : existing?.uses,
      entry: existing?.entry,
      filePath: existing?.filePath,
    });
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
