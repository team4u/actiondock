import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ActionContext, ActionContract, ActionRef, Logger } from "@actiondock/sdk";
import { defineAction } from "@actiondock/sdk";
import {
  ActionDockError,
  ACTION_FAILED,
  INVALID_ACTION_REF,
  INVALID_ARGUMENT,
} from "@actiondock/core";
import { parseActionRef } from "@actiondock/core/graph";
import { validateBindingName } from "@actiondock/core/project";
import type {
  Clock,
  EventSink,
  InvocationCallerInfo,
  InvocationTargetResolution,
  InvocationTargetResolver,
  PackageRuntime,
  RuntimeStorage,
  StorageFactory,
} from "@actiondock/core/package";
import {
  DefaultPackageRuntime,
  SystemClock,
  createNonClosingStorageView,
} from "@actiondock/core/package";

/**
 * 安全克隆数据快照，防止测试代码后续变异。
 */
function cloneSnapshot<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }
  return structuredClone(value);
}

/**
 * 规范化 Action 引用为完全限定结构。
 */
function normalizeMockActionRef(
  ref: ActionRef | string,
  defaultPackageId = "my-pkg"
): { canonicalRef: string; packageId: string; actionId: string } {
  if (ref === null || ref === undefined) {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid ActionRef for mock: expected string or ActionRef object, got ${ref === null ? "null" : typeof ref}`
    );
  }
  if (typeof ref !== "string" && typeof ref !== "object") {
    throw new ActionDockError(
      INVALID_ACTION_REF,
      `Invalid ActionRef for mock: expected string or ActionRef object, got ${typeof ref}`
    );
  }
  if (typeof ref === "object") {
    if (typeof ref.actionId !== "string" || !ref.actionId.trim()) {
      throw new ActionDockError(
        INVALID_ACTION_REF,
        "Invalid ActionRef for mock: actionId is required and must be a non-empty string"
      );
    }
    if (ref.packageId !== undefined && (typeof ref.packageId !== "string" || !ref.packageId.trim())) {
      throw new ActionDockError(
        INVALID_ACTION_REF,
        "Invalid ActionRef for mock: packageId must be a non-empty string when provided"
      );
    }
  }

  const parsed = parseActionRef(ref);
  const packageId = parsed.packageId || defaultPackageId;
  const actionId = parsed.actionId;
  const canonicalRef = `${packageId}/${actionId}`;
  const canonical = parseActionRef(canonicalRef);
  if (canonical.packageId !== packageId || canonical.actionId !== actionId) {
    throw new ActionDockError(INVALID_ACTION_REF, "Mock ActionRef must identify exactly one package and action");
  }
  return { canonicalRef, packageId, actionId };
}

/**
 * 动作模拟调用记录。
 */
export interface MockActionCall {
  /** 完全限定逻辑引用，如 "math-pkg/calc" */
  readonly ref: string;
  /** 有效绑定名称，缺省为 "default" */
  readonly binding: string;
  /** 调用输入参数快照 */
  readonly input: unknown;
  /** 当前执行子运行标识 */
  readonly runId?: string;
  /** 根运行标识 */
  readonly rootRunId?: string;
  /** 调用发生时间戳 */
  readonly timestamp: number;
}

/**
 * 模拟动作契约定义。
 */
export type MockActionContract = Pick<ActionContract,
  "inputSchema" | "outputSchema" | "uses" | "description" | "tags">;

/**
 * 模拟注册控制选项。
 */
export interface MockActionOptions {
  /** 命名绑定名称，不传视为 "default" */
  binding?: string;
  /** 可选的输入与输出 Schema 及依赖契约校验 */
  contract?: MockActionContract;
}

/**
 * 模拟动作执行处理函数。
 */
export type MockActionHandler<I = unknown, O = unknown> = (
  input: I,
  ctx: ActionContext
) => Promise<O> | O;

interface MockRule {
  handler: (input: any, ctx: ActionContext) => Promise<unknown> | unknown;
  contract?: MockActionContract;
}

function bindingName(value: unknown): string {
  return value === undefined ? "default" : validateBindingName(value);
}

function validateOptionKeys(value: unknown, allowed: readonly string[]): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new ActionDockError(INVALID_ARGUMENT, "Mock options must be a plain object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new ActionDockError(INVALID_ARGUMENT, `Unknown mock option '${String(key)}'`);
    }
  }
}

function validateMockOptions(options?: MockActionOptions): { binding: string; contract?: MockActionContract } {
  if (options === undefined) return { binding: "default" };
  validateOptionKeys(options, ["binding", "contract"]);
  if (options.contract !== undefined) {
    validateOptionKeys(options.contract, ["inputSchema", "outputSchema", "uses", "description", "tags"]);
  }
  return {
    binding: bindingName(options.binding),
    contract: options.contract ? structuredClone(options.contract) : undefined,
  };
}

function mergeContracts(
  primary?: MockActionContract,
  fallback?: MockActionContract
): MockActionContract | undefined {
  if (!primary && !fallback) return undefined;
  if (!primary) return fallback ? { ...fallback } : undefined;
  if (!fallback) return primary ? { ...primary } : undefined;
  return {
    inputSchema: primary.inputSchema !== undefined ? primary.inputSchema : fallback.inputSchema,
    outputSchema: primary.outputSchema !== undefined ? primary.outputSchema : fallback.outputSchema,
    uses: primary.uses !== undefined ? primary.uses : fallback.uses,
    description: primary.description ?? fallback.description,
    tags: primary.tags ?? fallback.tags,
  };
}

/**
 * 动作调用模拟器。
 * 专为单元测试环境提供细粒度的 Action 调用拦截、多目标绑定模拟、输入快照与断言检索。
 */
export class MockActionInvoker {
  private _calls: MockActionCall[] = [];
  private _revision = 0;
  private defaultPackageId: string;
  private clock: Clock;

  private persistentRules = new Map<string, MockRule>();
  private onceQueues = new Map<string, MockRule[]>();
  private configuredKeys = new Set<string>();
  private actionSpecs = new Map<
    string,
    { packageId: string; actionId: string; contract?: MockActionContract }
  >();

  constructor(defaultPackageId = "my-pkg", clock?: Clock) {
    this.defaultPackageId = defaultPackageId;
    this.clock = clock ?? new SystemClock();
  }

  /**
   * 已捕获的动作调用历史记录。
   */
  get calls(): readonly MockActionCall[] {
    return this._calls.map((call) => cloneSnapshot(call));
  }

  /**
   * 模拟规则版本序号。每次注册或重置规则单调递增，供测试运行时感知规则变更并失效缓存。
   */
  get revision(): number {
    return this._revision;
  }

  private recordActionSpec(
    canonicalRef: string,
    packageId: string,
    actionId: string,
    newContract?: MockActionContract
  ): void {
    const existing = this.actionSpecs.get(canonicalRef);
    if (!existing) {
      this.actionSpecs.set(canonicalRef, {
        packageId,
        actionId,
        contract: newContract ? { ...newContract } : undefined,
      });
      return;
    }

    if (newContract) {
      if (existing.contract) {
        if (
          existing.contract.inputSchema !== undefined &&
          newContract.inputSchema !== undefined &&
          !isDeepStrictEqual(existing.contract.inputSchema, newContract.inputSchema)
        ) {
          throw new ActionDockError(
            INVALID_ARGUMENT,
            `Conflicting inputSchema registered for action '${canonicalRef}'`
          );
        }
        if (
          existing.contract.outputSchema !== undefined &&
          newContract.outputSchema !== undefined &&
          !isDeepStrictEqual(existing.contract.outputSchema, newContract.outputSchema)
        ) {
          throw new ActionDockError(
            INVALID_ARGUMENT,
            `Conflicting outputSchema registered for action '${canonicalRef}'`
          );
        }
        if (
          existing.contract.uses !== undefined &&
          newContract.uses !== undefined &&
          !isDeepStrictEqual(existing.contract.uses, newContract.uses)
        ) {
          throw new ActionDockError(
            INVALID_ARGUMENT,
            `Conflicting uses registered for action '${canonicalRef}'`
          );
        }
        existing.contract = {
          inputSchema: newContract.inputSchema !== undefined ? newContract.inputSchema : existing.contract.inputSchema,
          outputSchema: newContract.outputSchema !== undefined ? newContract.outputSchema : existing.contract.outputSchema,
          uses: newContract.uses !== undefined ? newContract.uses : existing.contract.uses,
          description: newContract.description ?? existing.contract.description,
          tags: newContract.tags ?? existing.contract.tags,
        };
      } else {
        existing.contract = { ...newContract };
      }
    }
  }

  /**
   * 注册持续生效的动作模拟规则。
   *
   * @param ref 动作规范引用（支持完全限定或局部名称）
   * @param handler 模拟执行函数
   * @param options 绑定配置与契约定义
   */
  register<I = unknown, O = unknown>(
    ref: ActionRef | string,
    handler: MockActionHandler<I, O>,
    options?: MockActionOptions
  ): this;
  /**
   * 注册持续生效的动作模拟规则（静态 JSON 响应）。
   *
   * @param ref 动作规范引用（支持完全限定或局部名称）
   * @param jsonResult 静态返回的数据结果
   * @param options 绑定配置与契约定义
   */
  register<O = unknown>(
    ref: ActionRef | string,
    jsonResult: O,
    options?: MockActionOptions
  ): this;
  register(
    ref: ActionRef | string,
    handlerOrJsonResult: unknown,
    options?: MockActionOptions
  ): this {
    const { canonicalRef, packageId, actionId } = normalizeMockActionRef(
      ref,
      this.defaultPackageId
    );
    const { binding: effectiveBinding, contract } = validateMockOptions(options);
    const key = `${canonicalRef}#${effectiveBinding}`;

    this.recordActionSpec(canonicalRef, packageId, actionId, contract);

    const handler: MockActionHandler =
      typeof handlerOrJsonResult === "function"
        ? (handlerOrJsonResult as MockActionHandler)
        : () => cloneSnapshot(handlerOrJsonResult);

    this.persistentRules.set(key, {
      handler,
      contract,
    });
    this.configuredKeys.add(key);

    this._revision++;
    return this;
  }

  /**
   * 注册一次性消费的动作模拟规则。
   * 按注册顺序 FIFO 消费，耗尽后由持续规则接替；无持续规则时明确失败。
   *
   * @param ref 动作规范引用
   * @param handler 模拟执行函数
   * @param options 绑定配置与契约定义
   */
  registerOnce<I = unknown, O = unknown>(
    ref: ActionRef | string,
    handler: MockActionHandler<I, O>,
    options?: MockActionOptions
  ): this;
  /**
   * 注册一次性消费的动作模拟规则（静态 JSON 响应）。
   *
   * @param ref 动作规范引用
   * @param jsonResult 静态返回的数据结果
   * @param options 绑定配置与契约定义
   */
  registerOnce<O = unknown>(
    ref: ActionRef | string,
    jsonResult: O,
    options?: MockActionOptions
  ): this;
  registerOnce(
    ref: ActionRef | string,
    handlerOrJsonResult: unknown,
    options?: MockActionOptions
  ): this {
    const { canonicalRef, packageId, actionId } = normalizeMockActionRef(
      ref,
      this.defaultPackageId
    );
    const { binding: effectiveBinding, contract } = validateMockOptions(options);
    const key = `${canonicalRef}#${effectiveBinding}`;

    this.recordActionSpec(canonicalRef, packageId, actionId, contract);

    const handler: MockActionHandler =
      typeof handlerOrJsonResult === "function"
        ? (handlerOrJsonResult as MockActionHandler)
        : () => cloneSnapshot(handlerOrJsonResult);

    let queue = this.onceQueues.get(key);
    if (!queue) {
      queue = [];
      this.onceQueues.set(key, queue);
    }
    queue.push({
      handler,
      contract,
    });
    this.configuredKeys.add(key);

    this._revision++;
    return this;
  }

  /**
   * 检索调用历史记录。
   *
   * @param ref 可选动作引用筛选
   * @param options 可选绑定名称筛选
   */
  getCalls(
    ref?: ActionRef | string,
    options?: { binding?: string }
  ): MockActionCall[] {
    let result = this._calls;
    if (ref !== undefined) {
      const { canonicalRef } = normalizeMockActionRef(ref, this.defaultPackageId);
      result = result.filter((c) => c.ref === canonicalRef);
    }
    if (options !== undefined) {
      validateOptionKeys(options, ["binding"]);
      if (options.binding !== undefined) {
        const targetBinding = bindingName(options.binding);
        result = result.filter((call) => call.binding === targetBinding);
      }
    }
    return result.map((call) => cloneSnapshot(call));
  }

  /**
   * 仅清空历史调用记录，保留已注册的模拟规则。
   */
  clearHistory(): void {
    this._calls = [];
  }

  /**
   * 完全重置模拟器状态：清空所有调用历史与已注册的规则，并单调递增版本序号。
   */
  reset(): void {
    this._calls = [];
    this.persistentRules.clear();
    this.onceQueues.clear();
    this.configuredKeys.clear();
    this.actionSpecs.clear();
    this._revision++;
  }

  /**
   * 判断是否存在匹配指定完全限定引用与绑定的模拟规则。
   * 曾注册但 once 队列已耗尽的规则依然返回 true，由真实执行流抛出无可用规则错误。
   */
  hasRule(canonicalRef: string, binding?: string): boolean {
    const effectiveBinding = bindingName(binding);
    const key = `${canonicalRef}#${effectiveBinding}`;
    return this.configuredKeys.has(key);
  }

  /**
   * 获取指定引用的契约配置。
   */
  getContract(canonicalRef: string, binding?: string): MockActionContract | undefined {
    const effectiveBinding = bindingName(binding);
    const key = `${canonicalRef}#${effectiveBinding}`;
    const once = this.onceQueues.get(key)?.[0];
    const persistent = this.persistentRules.get(key);
    const ruleContract = once?.contract ?? persistent?.contract;
    const specContract = this.actionSpecs.get(canonicalRef)?.contract;
    return cloneSnapshot(mergeContracts(ruleContract, specContract));
  }

  /**
   * 获取当前所有已登记的 Action 引用元数据快照。
   */
  getActionSpecs(): Map<
    string,
    { packageId: string; actionId: string; contract?: MockActionContract }
  > {
    return new Map(Array.from(this.actionSpecs, ([ref, spec]) => [ref, cloneSnapshot(spec)]));
  }

  /**
   * 执行动作模拟调用。
   */
  async handleInvocation(
    canonicalRef: string,
    binding: string | undefined,
    input: unknown,
    ctx: ActionContext
  ): Promise<unknown> {
    const effectiveBinding = bindingName(binding);
    const key = `${canonicalRef}#${effectiveBinding}`;

    const record: MockActionCall = {
      ref: canonicalRef,
      binding: effectiveBinding,
      input: cloneSnapshot(input),
      runId: ctx.run?.id,
      rootRunId: ctx.run?.rootId,
      timestamp: this.clock.now().getTime(),
    };
    this._calls.push(record);

    let rule: MockRule | undefined;
    const queue = this.onceQueues.get(key);
    if (queue && queue.length > 0) {
      rule = queue.shift();
    } else if (this.persistentRules.has(key)) {
      rule = this.persistentRules.get(key);
    }

    if (!rule) {
      throw new ActionDockError(
        ACTION_FAILED,
        `No mock rule available for action '${canonicalRef}' with binding '${effectiveBinding}'`
      );
    }

    return await rule.handler(input, ctx);
  }

  /**
   * 构造用于 RuntimePlatform 接入的调用目标解析端口。
   */
  createInvocationTargetResolver(options: {
    clock?: Clock;
    storage?: RuntimeStorage;
    storageFactory?: StorageFactory;
    logger?: Logger;
    eventSink?: EventSink;
    getContractFallback?: (canonicalRef: string) => MockActionContract | undefined;
  }): InvocationTargetResolver {
    const stubRuntimes = new Map<string, PackageRuntime>();
    const self = this;

    return {
      resolve(
        action: { packageId: string; actionId: string },
        invokeOptions: { binding?: string } | undefined,
        _caller: InvocationCallerInfo
      ): InvocationTargetResolution | undefined {
        const canonicalRef = `${action.packageId}/${action.actionId}`;
        // 省略绑定时复用包图中的默认替身；显式 default 也命中同一组规则，
        // 不依赖生产绑定文件，避免给编程式动作额外施加清单命名限制。
        if (invokeOptions?.binding === undefined) return undefined;
        const effectiveBinding = invokeOptions.binding;
        const isNamedTarget = effectiveBinding !== "default";
        if (!self.hasRule(canonicalRef, effectiveBinding)) {
          return undefined;
        }

        const cacheKey = `${action.packageId}::${effectiveBinding}`;
        let runtime = stubRuntimes.get(cacheKey);
        if (!runtime) {
          const rawStorage = options.storageFactory
            ? options.storageFactory.createStorage(action.packageId)
            : options.storage;
          const actionStorage = rawStorage
            ? createNonClosingStorageView(rawStorage)
            : undefined;

          runtime = new DefaultPackageRuntime({
            identity: {
              id: action.packageId,
              instanceId: `mock:${randomUUID()}`,
              generation: randomUUID(),
            },
            projectConfig: {
              id: action.packageId,
              name: action.packageId,
              version: "1.0.0",
            },
            storage: actionStorage,
            inMemory: true,
            clock: options.clock,
            logger: options.logger,
            eventSink: options.eventSink,
            actionResolver: (actionId: string) => {
              const fullRef = `${action.packageId}/${actionId}`;
              const explicitContract = self.getContract(fullRef, effectiveBinding);
              const fallbackContract = options.getContractFallback?.(fullRef);
              const contract = mergeContracts(explicitContract, fallbackContract);
              return defineAction({
                id: actionId,
                inputSchema: contract?.inputSchema,
                outputSchema: contract?.outputSchema,
                uses: contract?.uses,
                run: async (input, ctx) => {
                  return self.handleInvocation(
                    fullRef,
                    effectiveBinding,
                    input,
                    ctx
                  );
                },
              });
            },
          });
          stubRuntimes.set(cacheKey, runtime);
        }

        return {
          runtime,
          scope: isNamedTarget ? `binding:${effectiveBinding}` : undefined,
          requiresExplicitUses: isNamedTarget,
        };
      },

      async close(): Promise<void> {
        // 返回的目标 Runtime 由 Host 统一关闭，端口只清理自身缓存。
        stubRuntimes.clear();
      },
    };
  }
}
