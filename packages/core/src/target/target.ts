import { createActionDock } from "../service/factory";
import { LocalActionDockTarget } from "./local";
import { RemoteActionDockTarget } from "./remote";
import type {
  ActionDockTarget,
  LocalTargetOptions,
  RemoteTargetOptions,
  TargetOptions,
} from "./types";

/**
 * 工厂函数：统一创建 ActionDockTarget 实例。
 * 内部委托 createActionDock 服务构造，依据传入参数自动决策创建本地或远程 Target 适配层。
 */
export async function createActionDockTarget(
  options: TargetOptions = {}
): Promise<ActionDockTarget> {
  if (options.type === "ipc") {
    const { IpcActionDockTarget } = await import("../ipc/target");
    return new IpcActionDockTarget(options as any);
  }

  if (
    options.type === "remote" ||
    ("serverUrl" in options && Boolean((options as RemoteTargetOptions).serverUrl))
  ) {
    return new RemoteActionDockTarget(options as RemoteTargetOptions);
  }

  const localOpts = options as LocalTargetOptions;
  const service = await createActionDock(localOpts);
  return new LocalActionDockTarget(service);
}
