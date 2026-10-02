/**
 * 全局禁用 Node.js 所有的 ExperimentalWarning 实验性特性警告。
 * 跨所有 Node.js 运行版本，不区分具体特性（如 SQLite、类型擦除等），
 * 在进程级别统一静默全部实验性警告，同时完整保留废弃警告与运行期异常。
 *
 * 逃生通道：当环境变量 ACTIONDOCK_SILENCE_WARNINGS 显式设置为 "0" 时，放弃静默以供深度调试排查。
 */
const kExperimentalWarningSuppressed = Symbol.for("actiondock.experimental_warning_suppressed");

interface WarningLike {
  name?: string;
  type?: string;
  message?: string;
}

export function suppressExperimentalWarnings(): void {
  // 逃生通道：支持开发者显式禁用静默逻辑，确保排障透明度
  if (process.env.ACTIONDOCK_SILENCE_WARNINGS === "0") {
    return;
  }

  const globalObj = globalThis as Record<symbol, unknown>;
  if (globalObj[kExperimentalWarningSuppressed]) {
    return;
  }
  globalObj[kExperimentalWarningSuppressed] = true;

  // 1. 拦截 process.emitWarning 源头
  const originalEmitWarning = process.emitWarning;
  if (typeof originalEmitWarning === "function") {
    process.emitWarning = function (warning: string | Error, ...args: unknown[]): void {
      if (typeof warning === "string") {
        const type = typeof args[0] === "string" ? args[0] : (args[0] as WarningLike)?.type || args[1];
        if (type === "ExperimentalWarning") {
          return;
        }
      } else if (warning) {
        const warnObj = warning as WarningLike;
        if (warnObj.name === "ExperimentalWarning" || warnObj.type === "ExperimentalWarning") {
          return;
        }
      }
      return Reflect.apply(originalEmitWarning, process, [warning, ...args]);
    } as typeof process.emitWarning;
  }

  // 2. 包装进程级 warning 事件分发器，作为双层防护
  const originalListeners = process.listeners("warning");
  process.removeAllListeners("warning");

  process.on("warning", (warning: Error) => {
    const warnObj = warning as WarningLike;
    if (warnObj.name === "ExperimentalWarning" || warnObj.type === "ExperimentalWarning") {
      return;
    }
    for (const listener of originalListeners) {
      listener.call(process, warning);
    }
  });
}

// 模块被引入时立即自执行
suppressExperimentalWarnings();
