/**
 * 包唯一物理与快照身份标识值对象（PackageIdentity）。
 * 
 * 铁律 7：只在 PackageRuntime 创建时生成一次，统一传递给 ExecutionService、
 * Runner、ProcessOwner、RunRecord 等，禁止内部组件自行 fallback。
 */
export interface PackageIdentity {
  /** 包唯一逻辑标识符 */
  readonly id: string;
  /** 包物理实例标识符（单次加载/运行周期的全局唯一物理实例标识） */
  readonly instanceId: string;
  /** 快照代次标识符 */
  readonly generation: string;
}

/**
 * 创建 PackageIdentity 值对象单一事实工厂。
 */
export function createPackageIdentity(options: {
  id: string;
  instanceId?: string;
  generation?: string;
}): PackageIdentity {
  return Object.freeze({
    id: options.id,
    instanceId: options.instanceId || options.id,
    generation: options.generation || "1",
  });
}
