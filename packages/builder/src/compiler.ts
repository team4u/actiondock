import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { CompilerError, CompilerValidationError } from "./errors";
import type { BunCompilerOptions, BunCompilerResult } from "./types";

/**
 * 异步执行子进程命令，收集标准输出与错误输出。
 */
async function execCommandAsync(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<{ status: number | null; stdout: string; stderr: string; error?: Error }> {
  return new Promise((res) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (err) => {
      res({
        status: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        error: err,
      });
    });
    child.on("close", (code) => {
      res({
        status: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      });
    });
  });
}

/**
 * 流式计算文件的 SHA-256 校验和，杜绝大文件直接读入内存。
 */
async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => res(hash.digest("hex")));
    stream.on("error", rej);
  });
}

/**
 * 异步探测 Bun 版本。
 */
async function getBunVersion(): Promise<string> {
  if (typeof (globalThis as any).Bun !== "undefined" && (globalThis as any).Bun.version) {
    return (globalThis as any).Bun.version;
  }
  try {
    const res = await execCommandAsync("bun", ["--version"], { cwd: process.cwd(), env: process.env });
    if (res.status === 0) {
      return res.stdout.trim();
    }
  } catch {}
  return "unknown";
}

/**
 * 官方支持的 Bun 独立二进制编译目标列表。
 */
const SUPPORTED_TARGETS = new Set<string>([
  "bun",
  "host",
  "bun-linux-x64",
  "linux-x64",
  "bun-linux-arm64",
  "linux-arm64",
  "bun-darwin-x64",
  "darwin-x64",
  "bun-darwin-arm64",
  "darwin-arm64",
  "bun-windows-x64",
  "windows-x64",
  "bun-linux-x64-baseline",
  "linux-x64-baseline",
  "bun-linux-x64-modern",
  "linux-x64-modern",
]);

/**
 * 校验目标架构并规范化。
 */
function normalizeAndValidateTarget(target?: string): string {
  if (!target || target === "host" || target === "bun") {
    return "bun";
  }

  const cleanTarget = target.trim();
  if (!SUPPORTED_TARGETS.has(cleanTarget)) {
    throw new CompilerValidationError(
      `Unsupported compilation target: '${target}'. Standalone compilation only supports Bun targets (e.g. linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64).`,
      { code: "UNSUPPORTED_TARGET", target }
    );
  }

  return cleanTarget.startsWith("bun-") ? cleanTarget : `bun-${cleanTarget}`;
}

/**
 * 规范化编译器错误输出。
 */
function normalizeCompilerError(rawStderr: string, rawStdout: string, exitCode: number, target?: string): CompilerError {
  const combined = `${rawStderr}\n${rawStdout}`.trim();
  const lines = combined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let code = "COMPILATION_FAILED";
  if (combined.includes("Unsupported target")) {
    code = "UNSUPPORTED_TARGET";
  } else if (
    combined.includes("Cannot find package") ||
    combined.includes("Cannot find module") ||
    combined.includes("Could not resolve")
  ) {
    code = "MODULE_NOT_FOUND";
  } else if (
    combined.includes("SyntaxError") ||
    combined.includes("Parse error") ||
    combined.includes("Expected") ||
    combined.includes("Unexpected")
  ) {
    code = "SYNTAX_ERROR";
  } else if (combined.includes("EACCES") || combined.includes("Permission denied")) {
    code = "PERMISSION_DENIED";
  } else if (combined.includes("ENOSPC") || combined.includes("no space left")) {
    code = "NO_SPACE";
  }

  const summaryLine = lines.find((l) => l.startsWith("error:")) || lines[0] || "Bun compilation failed";

  return new CompilerError(
    `Bun compilation failed with exit code ${exitCode} (${code}): ${summaryLine}`,
    {
      code,
      exitCode,
      rawError: combined,
      details: lines,
      target,
    }
  );
}

/**
 * Bun 独立二进制编译器。
 * 封装 bun build --compile 调用，提前校验选项组合，收集构建产物与元数据。
 */
export class BunCompiler {
  /**
   * 执行独立二进制编译。
   * 
   * @param options 编译参数
   * @returns 编译产物元数据结果
   */
  public async compile(options: BunCompilerOptions): Promise<BunCompilerResult> {
    const startTime = Date.now();

    // 1. 入口点存在性校验
    if (!options.entrypoint) {
      throw new CompilerValidationError("Entrypoint must be specified for standalone compilation", {
        code: "INVALID_ENTRYPOINT",
      });
    }

    const resolvedEntry = resolve(options.entrypoint);
    if (!existsSync(resolvedEntry)) {
      throw new CompilerValidationError(
        `Entrypoint file not found: ${options.entrypoint}`,
        { code: "ENTRYPOINT_NOT_FOUND" }
      );
    }

    // 2. 输出路径校验
    if (!options.outfile) {
      throw new CompilerValidationError("Outfile path must be specified for standalone compilation", {
        code: "INVALID_OUTFILE",
      });
    }

    const resolvedOutfile = resolve(options.outfile);
    const outDir = dirname(resolvedOutfile);
    mkdirSync(outDir, { recursive: true });

    // 3. 目标平台与选项校验
    const normalizedTarget = normalizeAndValidateTarget(options.target);
    const isWindowsTarget =
      normalizedTarget.includes("windows") ||
      (!options.target && process.platform === "win32");

    // 校验布尔选项
    if (options.minify !== undefined && typeof options.minify !== "boolean") {
      throw new CompilerValidationError("Option 'minify' must be a boolean", {
        code: "INVALID_MINIFY_OPTION",
      });
    }
    if (options.bytecode !== undefined && typeof options.bytecode !== "boolean") {
      throw new CompilerValidationError("Option 'bytecode' must be a boolean", {
        code: "INVALID_BYTECODE_OPTION",
      });
    }

    // 4. 组装 Bun build 命令参数
    const args = [
      "bun",
      "build",
      resolvedEntry,
      "--compile",
      "--outfile",
      resolvedOutfile,
    ];

    const bytecode = options.bytecode !== false;
    if (bytecode) {
      args.push("--bytecode");
    }

    const minify = options.minify !== false;
    if (minify) {
      args.push("--minify");
    }

    if (normalizedTarget !== "bun") {
      args.push(`--target=${normalizedTarget}`);
    }

    // 5. 执行外部编译器进程
    const cwd = options.cwd ? resolve(options.cwd) : dirname(resolvedEntry);
    const proc = await execCommandAsync(args[0], args.slice(1), {
      cwd,
      env: {
        ...process.env,
        ...options.env,
      },
    });

    if (proc.error) {
      if ((proc.error as any).code === "ENOENT") {
        throw new CompilerError(
          "Bun binary not found in PATH. Standalone compilation requires Bun to be installed (e.g. via 'curl -fsSL https://bun.sh/install | bash' or 'npm install -g bun').",
          {
            code: "BUN_NOT_FOUND",
            exitCode: 1,
            rawError: proc.error.message,
            target: options.target,
          }
        );
      }
      throw new CompilerError(`Failed to spawn Bun compiler: ${proc.error.message}`, {
        code: "SPAWN_FAILED",
        exitCode: 1,
        rawError: proc.error.message,
        target: options.target,
      });
    }

    if (proc.status !== 0) {
      throw normalizeCompilerError(proc.stderr, proc.stdout, proc.status ?? 1, options.target);
    }

    // 6. 解析生成的可执行二进制物理路径（适配 Windows .exe 后缀特性）
    let actualExecutablePath = resolvedOutfile;
    if (!existsSync(actualExecutablePath) && isWindowsTarget) {
      const withExe = `${resolvedOutfile}.exe`;
      if (existsSync(withExe)) {
        actualExecutablePath = withExe;
      }
    }

    if (!existsSync(actualExecutablePath)) {
      throw new CompilerError(
        `Compiler completed with exit code 0 but output executable not found at ${resolvedOutfile}`,
        {
          code: "OUTPUT_NOT_FOUND",
          exitCode: 0,
          rawError: "Output executable file not found on disk",
          target: options.target,
        }
      );
    }

    // 7. 计算二进制大小与流式校验和
    const sizeBytes = statSync(actualExecutablePath).size;
    const sha256 = await computeFileSha256(actualExecutablePath);
    const durationMs = Date.now() - startTime;
    const compiledAt = new Date().toISOString();

    // 8. 写入 metadata 产物文件
    let metadataPath: string | undefined;
    if (options.emitMetadata !== false) {
      const targetSlug = (options.target || "host").replace(/[^a-zA-Z0-9_-]/g, "-");
      const targetMetadataPath = resolve(outDir, `artifact.${targetSlug}.json`);
      metadataPath = resolve(outDir, "artifact.json");
      const bunVersion = await getBunVersion();

      const metadata = {
        packageId: options.packageId,
        version: options.version,
        target: options.target || "host",
        executable: basename(actualExecutablePath),
        sizeBytes,
        sha256,
        bunVersion,
        minify,
        bytecode,
        actions: options.actions || [],
        compiledAt,
      };
      const metadataContent = JSON.stringify(metadata, null, 2) + "\n";
      writeFileSync(targetMetadataPath, metadataContent, "utf-8");
      writeFileSync(metadataPath, metadataContent, "utf-8");
      metadataPath = targetMetadataPath;
    }

    return {
      packageId: options.packageId,
      version: options.version,
      target: options.target || "host",
      executablePath: actualExecutablePath,
      sizeBytes,
      sha256,
      metadataPath,
      minify,
      bytecode,
      durationMs,
      compiledAt,
    };
  }

  /**
   * 静态辅助调用方法。
   */
  public static async compile(options: BunCompilerOptions): Promise<BunCompilerResult> {
    const compiler = new BunCompiler();
    return compiler.compile(options);
  }
}

/**
 * 快捷独立二进制编译函数。
 */
export async function compileBinary(options: BunCompilerOptions): Promise<BunCompilerResult> {
  return BunCompiler.compile(options);
}
