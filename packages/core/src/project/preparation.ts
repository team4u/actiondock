import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
  LocalPackagePreparationContext,
  LocalPackagePreparationTarget,
  LocalPackagePreparer,
} from "../invocation/types";
import { ActionDockError, ACTION_CANCELLED, DEPENDENCIES_NOT_READY } from "../errors";
import {
  ensureProjectDependencies,
  resolveInstallRoot,
  type EnsureProjectDependenciesOptions,
} from "./dependencies";

interface InFlightTask {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  waiters: number;
  settled: boolean;
}

function cancellationError(reason: unknown): ActionDockError {
  return new ActionDockError(
    ACTION_CANCELLED,
    reason instanceof Error ? reason.message : String(reason ?? "Package preparation was cancelled"),
    { cause: reason }
  );
}

function isCancellation(error: unknown): boolean {
  return (error instanceof ActionDockError && error.code === ACTION_CANCELLED) ||
    (error instanceof Error && error.name === "AbortError");
}

/**
 * 创建单个宿主使用的本地包准备器。
 * 包实例独立缓存就绪状态；同一根调用的同一安装目录共享在途任务。
 * 共享成功后，各包仍须通过自己的依赖检查；失败不重试、不缓存。
 */
export function createLocalPackagePreparer(
  options: Omit<EnsureProjectDependenciesOptions, "signal"> = {}
): LocalPackagePreparer {
  const readyCache = new Set<string>();
  const canonicalRootCache = new Map<string, string>();
  const inFlightTasks = new Map<string, InFlightTask>();

  function getPackageInstanceKey(target: LocalPackagePreparationTarget): string {
    let canonicalRoot = canonicalRootCache.get(target.packageRoot);
    if (!canonicalRoot) {
      const path = resolve(target.packageRoot);
      try {
        canonicalRoot = realpathSync(path);
        canonicalRootCache.set(target.packageRoot, canonicalRoot);
      } catch (error: any) {
        throw new ActionDockError(
          DEPENDENCIES_NOT_READY,
          `Cannot resolve project directory '${path}': ${error?.message || String(error)}`,
          { path, cause: error }
        );
      }
    }
    return JSON.stringify([
      target.identity.id,
      target.identity.instanceId,
      target.identity.generation,
      canonicalRoot,
    ]);
  }

  async function waitForTask(task: InFlightTask, signal: AbortSignal): Promise<void> {
    let released = false;
    const releaseWaiter = () => {
      if (!released) {
        released = true;
        task.waiters--;
      }
      return task.waiters;
    };

    const stopIfUnused = async () => {
      if (releaseWaiter() !== 0 || task.settled) return;
      task.controller.abort(signal.reason);
      try {
        await task.promise;
      } catch (error) {
        if (!isCancellation(error)) throw error;
      }
    };

    if (signal.aborted) {
      await stopIfUnused();
      throw cancellationError(signal.reason);
    }

    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        void stopIfUnused().then(
          () => reject(cancellationError(signal.reason)),
          reject
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });

    try {
      await Promise.race([task.promise, aborted]);
      if (signal.aborted) throw cancellationError(signal.reason);
    } finally {
      releaseWaiter();
      signal.removeEventListener("abort", onAbort);
    }
  }

  return async function prepareLocalPackage(
    target: LocalPackagePreparationTarget,
    context: LocalPackagePreparationContext
  ): Promise<void> {
    if (context.signal.aborted) throw cancellationError(context.signal.reason);
    if (!target.packageRoot) return;

    const instanceKey = getPackageInstanceKey(target);
    if (readyCache.has(instanceKey)) return;

    const root = resolveInstallRoot(target.packageRoot);
    if (root.skip || !root.installRoot) {
      if (context.signal.aborted) throw cancellationError(context.signal.reason);
      readyCache.add(instanceKey);
      return;
    }
    const flightKey = JSON.stringify([context.rootRunId, root.installRoot]);

    while (!readyCache.has(instanceKey)) {
      if (context.signal.aborted) throw cancellationError(context.signal.reason);
      const existing = inFlightTasks.get(flightKey);
      if (existing) {
        existing.waiters++;
        await waitForTask(existing, context.signal);
        continue;
      }

      const controller = new AbortController();
      let task!: InFlightTask;
      // 先登记任务与等待者，再开始底层检查，兼容同步完成的测试驱动。
      const promise = Promise.resolve().then(async () => {
        try {
          if (controller.signal.aborted) throw cancellationError(controller.signal.reason);
          await ensureProjectDependencies(target.packageRoot, { ...options, signal: controller.signal });
          readyCache.add(instanceKey);
        } finally {
          task.settled = true;
          if (inFlightTasks.get(flightKey) === task) inFlightTasks.delete(flightKey);
        }
      });
      task = { controller, promise, waiters: 1, settled: false };
      inFlightTasks.set(flightKey, task);
      await waitForTask(task, context.signal);
    }
  };
}
