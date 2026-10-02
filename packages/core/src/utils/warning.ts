/**
 * 全局禁用 Node.js 所有的 ExperimentalWarning 实验性特性警告。
 * 跨所有 Node.js 运行版本，不区分具体特性（如 SQLite、类型擦除等），
 * 在进程级别统一静默全部实验性警告，同时完整保留废弃警告与运行期异常。
 */
const kExperimentalWarningSuppressed = Symbol.for("actiondock.experimental_warning_suppressed");

export function suppressExperimentalWarnings(): void {
  const globalObj = globalThis as Record<symbol, unknown>;
  if (globalObj[kExperimentalWarningSuppressed]) {
    return;
  }
  globalObj[kExperimentalWarningSuppressed] = true;

  // 1. 拦截 process.emitWarning 源头
  const originalEmitWarning = process.emitWarning;
  if (typeof originalEmitWarning === "function") {
    process.emitWarning = function (warning: string | Error, ...args: any[]): void {
      if (typeof warning === "string") {
        const type = typeof args[0] === "string" ? args[0] : (args[0]?.type || args[1]);
        if (type === "ExperimentalWarning") {
          return;
        }
      } else if (warning && (warning.name === "ExperimentalWarning" || (warning as any).type === "ExperimentalWarning")) {
        return;
      }
      return Reflect.apply(originalEmitWarning, process, [warning, ...args]);
    } as typeof process.emitWarning;
  }

  // 2. 包装进程级 warning 事件分发器，作为双层防护
  const originalListeners = process.listeners("warning");
  process.removeAllListeners("warning");

  process.on("warning", (warning: Error) => {
    if (warning.name === "ExperimentalWarning" || (warning as any).type === "ExperimentalWarning") {
      return;
    }
    for (const listener of originalListeners) {
      listener.call(process, warning);
    }
  });
}

// 模块被引入时立即自执行
suppressExperimentalWarnings();
