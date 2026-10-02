import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BuilderError } from "./errors";

/**
 * 在暂存目录调用带有 --ignore-scripts 的 npm pack 生成标准 npm 压缩包（.tgz）。
 * 优先解析 --json 结构化输出，失败时回退到尾部行文件名解析。
 * Windows 兼容：npm 是 .cmd 脚本，无 shell 直接 spawn 会 ENOENT/EINVAL。
 */
export async function runNpmPack(
  stagingPkgDir: string,
  packDestination: string,
  fallbackName: string
): Promise<string> {
  const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
    (resolvePromise, rejectPromise) => {
      const child = spawn(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", packDestination],
        {
          cwd: stagingPkgDir,
          shell: process.platform === "win32",
        }
      );
      let stdoutBuf = "";
      let stderrBuf = "";
      child.stdout.on("data", (chunk) => (stdoutBuf += chunk));
      child.stderr.on("data", (chunk) => (stderrBuf += chunk));
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        if (code === 0) {
          resolvePromise({ stdout: stdoutBuf, stderr: stderrBuf });
        } else {
          rejectPromise(
            new BuilderError(
              `npm pack exited with code ${code}. Output:\n${stdoutBuf}\n${stderrBuf}`
            )
          );
        }
      });
    }
  );

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
