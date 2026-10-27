import { existsSync } from "node:fs";
import { join } from "node:path";
import { runPackageManager, type RunPackageManagerOptions } from "@actiondock/core/project";
import { BuilderError } from "./errors";

/**
 * 在暂存目录调用带有 --ignore-scripts 的 npm pack 生成标准 npm 压缩包（.tgz）。
 * 使用 --json=false 确保标准输出仅输出单行压缩包文件名（显式覆盖 npm_config_json 等环境配置）。
 * 复用统一包管理器启动解析与驱动底座，以 shell: false 执行，完整保留路径参数与特殊字符边界。
 */
export async function runNpmPack(
  stagingPkgDir: string,
  packDestination: string,
  _fallbackName?: string,
  options?: RunPackageManagerOptions
): Promise<string> {
  const args = [
    "pack",
    "--ignore-scripts",
    "--json=false",
    "--pack-destination",
    packDestination,
  ];

  let procResult;
  try {
    procResult = await runPackageManager("npm", args, {
      ...options,
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
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new BuilderError(
      `npm pack produced empty stdout; expected tarball filename. Output:\n${stdout}\nStderr:\n${procResult.stderr}`
    );
  }

  if (lines.length > 1) {
    throw new BuilderError(
      `npm pack produced unexpected multi-line output; expected single tarball filename. Output:\n${stdout}`
    );
  }

  const generatedName = lines[0];
  if (!generatedName.endsWith(".tgz")) {
    throw new BuilderError(
      `npm pack produced unexpected output line '${generatedName}'; expected .tgz filename. Output:\n${stdout}`
    );
  }

  const generatedTarball = join(packDestination, generatedName);
  if (!existsSync(generatedTarball)) {
    throw new BuilderError(
      `npm pack did not produce expected tarball at ${generatedTarball}. Output:\n${stdout}`
    );
  }

  return generatedTarball;
}
