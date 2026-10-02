import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { BuilderError } from "./errors";
import { isOwnAction } from "./types";
import type { SelectionPlan } from "./types";

/**
 * 判断文件路径是否为 TypeScript 源码。
 */
export function isTypeScriptSource(path: string): boolean {
  return path.endsWith(".ts") || path.endsWith(".mts");
}

/**
 * 解析项目本地 TypeScript 编译器（回退到打包工具自身依赖）。
 */
export async function resolveTypeScriptCompiler(root: string): Promise<any> {
  try {
    const req = createRequire(join(root, "package.json"));
    const tsPath = req.resolve("typescript");
    const imported = await import(tsPath);
    return imported.default || imported;
  } catch {
    try {
      const imported = await import("typescript");
      return imported.default || imported;
    } catch {
      throw new BuilderError(
        `TypeScript is required to pack TypeScript Action packages, but 'typescript' could not be resolved from ${root}.`
      );
    }
  }
}

export interface CompileProjectTypescriptOptions {
  root: string;
  stagingPkgDir: string;
  plan: SelectionPlan;
}

/**
 * 在暂存目录内执行 TypeScript 编译，产出 .js 与 .d.ts。
 * 仅在存在 TypeScript 源码时执行。
 */
export async function compileProjectTypescript(
  options: CompileProjectTypescriptOptions
): Promise<void> {
  const { root, stagingPkgDir, plan } = options;
  const hasTypeScript =
    plan.actions.some((a) => isTypeScriptSource(a.entry)) ||
    plan.dependencies.modulesAndAssets.some(
      (m) => (m.type === "module" || m.type === "file") && isTypeScriptSource(m.path)
    );
  if (!hasTypeScript) {
    return;
  }

  const ts = await resolveTypeScriptCompiler(root);

  const tsSourceFiles = new Set<string>();
  for (const act of plan.actions) {
    if (!isOwnAction(act)) continue;
    if (isTypeScriptSource(act.entry)) {
      tsSourceFiles.add(act.resolvedPath);
    }
  }
  for (const mod of plan.dependencies.modulesAndAssets) {
    if ((mod.type === "module" || mod.type === "file") && isTypeScriptSource(mod.path)) {
      tsSourceFiles.add(mod.resolvedPath);
    }
  }

  const compilerOptions: any = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    declaration: true,
    emitDeclarationOnly: false,
    rewriteRelativeImportExtensions: true,
    rootDir: root,
    outDir: stagingPkgDir,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    allowJs: true,
  };

  const tsconfigPath = join(root, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (configFile.error) {
        throw new BuilderError(
          ts.formatDiagnostic(configFile.error),
          "TSCONFIG_READ_FAILED"
        );
      }
      const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
      if (parsedConfig.errors && parsedConfig.errors.length > 0) {
        throw new BuilderError(
          ts.formatDiagnostics(parsedConfig.errors),
          "TSCONFIG_PARSE_FAILED"
        );
      }
      // tsc 不会改写 import 说明符：paths 路径别名在产物中无法解析，必须显式拒绝而非静默编译出坏产物
      if (parsedConfig.options.paths && Object.keys(parsedConfig.options.paths).length > 0) {
        throw new BuilderError(
          `tsconfig.json 'paths' aliases are not supported in packed output: TypeScript does not rewrite import specifiers, so the packed artifact would contain unresolvable module specifiers. Replace path aliases with relative imports, or pre-build the project and pack the compiled output instead.`,
          "PATHS_ALIAS_UNSUPPORTED"
        );
      }
      Object.assign(compilerOptions, parsedConfig.options, {
        outDir: stagingPkgDir,
        rootDir: root,
        declaration: true,
        emitDeclarationOnly: false,
        rewriteRelativeImportExtensions: true,
        noEmit: false,
      });
    } catch (err) {
      if (
        err instanceof BuilderError &&
        err.code !== "TSCONFIG_READ_FAILED" &&
        err.code !== "TSCONFIG_PARSE_FAILED"
      ) {
        throw err;
      }
      // tsconfig 解析失败回退默认 compilerOptions，但必须输出显著告警：
      // 用户配置的 strict、target 等被丢弃可能编译出行为不同的产物，严禁无提示
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[actiondock] Warning: Failed to parse tsconfig.json at ${tsconfigPath}; falling back to default compiler options for packed output. Root cause: ${reason}`
      );
    }
  }

  const host = ts.createCompilerHost(compilerOptions);
  const program = ts.createProgram(Array.from(tsSourceFiles), compilerOptions, host);
  const emitResult = program.emit();

  const preEmitDiagnostics = ts.getPreEmitDiagnostics(program);
  const allDiagnostics = [...preEmitDiagnostics, ...emitResult.diagnostics];
  const errors = allDiagnostics.filter(
    (d: any) => d.category === ts.DiagnosticCategory.Error
  );

  if (errors.length > 0 || emitResult.emitSkipped) {
    const diagnosticsToFormat = errors.length > 0 ? errors : allDiagnostics;
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnosticsToFormat, {
      getCanonicalFileName: (f: string) => f,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    });
    throw new BuilderError(`TypeScript compilation failed during pack:\n${formatted}`);
  }
}
