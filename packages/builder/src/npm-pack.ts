import { existsSync } from "node:fs";
import { join } from "node:path";
import { runPackageManager } from "@actiondock/core/project";
import { BuilderError } from "./errors";

/**
 * 在暂存目录调用带有 --ignore-scripts 的 npm pack 生成标准 npm 压缩包（.tgz）。
 * 优先解析 --json 结构化输出，失败时回退到尾部行文件名解析。
 * 复用统一包管理器启动解析与驱动底座，以 shell: false 执行，完整保留路径参数与特殊字符边界。
 */
export async function runNpmPack(
  stagingPkgDir: string,
  packDestination: string,
  fallbackName: string
): Promise<string> {
  const args = [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    packDestination,
  ];

  let procResult;
  try {
    procResult = await runPackageManager("npm", args, {
      cwd: stagingPkgDir,
    });
  } catch (err: any) {
    throw new BuilderError(
      `npm pack failed to execute: ${err?.message || String(err)}`
    );
  }

  if (procResult.status !== 0) {
    throw new BuilderError(
      `npm pack exited with code ${procResult.status}. Output:\n${procResult.stdout}\n${procResult.stderr}`
    );
  }

  const stdout = procResult.stdout;

  // 优先解析 --json 结构化输出中的压缩包文件名
  let generatedName: string | undefined;
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      let items: Array<{ filename?: unknown }>;
      if (Array.isArray(parsed)) {
        items = parsed as Array<{ filename?: unknown }>;
      } else if (typeof parsed === "object" && parsed !== null) {
        // npm >= 11 的 pack --json 输出为按包名索引的对象，取全部包含 filename 的条目
        items = Object.values(parsed).filter(
          (entry): entry is { filename?: unknown } =>
            typeof entry === "object" && entry !== null && "filename" in entry
        );
      } else {
        items = [];
      }
      // 多包输出时取最后一个 filename（npm 按依赖顺序逐包输出，末尾为当前项目产物）
      const filenames = items
        .map((item) => item.filename)
        .filter((name): name is string => typeof name === "string" && name.length > 0);
      const filename = filenames[filenames.length - 1];
      if (filename !== undefined) {
        generatedName = filename;
      }
    } catch {
      // 回退到尾部行解析
    }
  }

  if (!generatedName) {
    const packLines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const tgzLine = packLines.slice().reverse().find((line) => line.endsWith(".tgz"));
    generatedName = tgzLine || packLines.pop() || fallbackName;
  }

  const generatedTarball = join(packDestination, generatedName);
  if (!existsSync(generatedTarball)) {
    throw new BuilderError(
      `npm pack did not produce expected tarball at ${generatedTarball}. Output:\n${stdout}`
    );
  }
  return generatedTarball;
}
