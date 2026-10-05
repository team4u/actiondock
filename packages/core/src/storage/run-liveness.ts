import { isProcessAlive } from "../utils";
import type { Clock } from "./clock";
import { isTerminalRunStatus } from "./types";

/**
 * 无进程标识的遗留记录心跳过期阈值（毫秒）。
 *
 * 遗留记录（未落库宿主进程标识的旧版本写入）无法做进程存活探测，只能依赖
 * 心跳时间戳兜底判定。阈值必须显著大于执行服务的心跳刷新间隔
 * （RUN_HEARTBEAT_INTERVAL_MS），保证心跳正常的宿主绝不被误判过期；
 * 同时保持足够小，使真正崩溃后的遗留记录能在下次打开时被及时收敛。
 */
export const RUN_LIVENESS_GRACE_MS = 90_000;

/**
 * 候选收割记录的最小判定输入。
 *
 * 只取判定所需字段，避免收割判定逻辑耦合完整运行记录投影。
 */
export interface LivenessCandidate {
  /** 运行标识 */
  id: string;
  /** 运行生命周期状态（可选，终态记录不属于宿主死亡异常） */
  status?: string;
  /** 写入方宿主进程标识（遗留记录可能缺失） */
  hostPid?: number | null;
  /** 最后一次心跳刷新时间（ISO 8601） */
  heartbeatAt?: string | null;
  /** 运行开始时间（ISO 8601） */
  startedAt?: string | null;
}

/**
 * 进程存活探测函数契约（便于测试注入确定性替身）。
 */
export type ProcessLivenessProbe = (pid: number) => boolean;

/**
 * 判定单条运行记录的执行宿主是否确认死亡。
 *
 * 存活判断核心准则：
 * - 终态记录不属于「宿主死亡」的在途异常，返回 false；
 * - 携带合法 hostPid 时以进程探测（process.kill(pid, 0)）为准，进程明确不存在（ESRCH）才判死；
 * - 无 hostPid 时仅在存在显式 heartbeatAt 且超时超过宽限期才判死；
 * - 缺少可靠存活依据时，严禁凭「开始时间超过九十秒」认定死亡，保守返回 false。
 *
 * @param candidate 候选记录
 * @param options 可选注入：进程探测替身、时钟替身与心跳宽限期
 */
export function isRunHostDead(
  candidate: LivenessCandidate,
  options?: {
    probe?: ProcessLivenessProbe;
    clock?: Clock;
    graceMs?: number;
  }
): boolean {
  if (candidate.status && isTerminalRunStatus(candidate.status)) {
    return false;
  }

  const pid = candidate.hostPid;
  if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
    const probe = options?.probe ?? isProcessAlive;
    // 存活（含权限受限的 EPERM 保守存活）一律保留；仅明确的进程不存在才判死
    return !probe(pid);
  }

  if (candidate.heartbeatAt) {
    const heartbeatMs = Date.parse(candidate.heartbeatAt);
    if (!Number.isNaN(heartbeatMs)) {
      const graceMs = options?.graceMs ?? RUN_LIVENESS_GRACE_MS;
      const nowMs = options?.clock ? options.clock.now().getTime() : Date.now();
      return nowMs - heartbeatMs > graceMs;
    }
  }

  // 缺少可靠依据（既无有效 hostPid 也无有效 heartbeatAt）：绝不凭 startedAt 认定死亡
  return false;
}

