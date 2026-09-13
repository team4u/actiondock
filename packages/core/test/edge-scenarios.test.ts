import { describe, expect, it } from "bun:test";
import { defineAction, type ActionContext } from "@actiondock/sdk";
import { ActionRunner } from "../src/runtime/runner";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import {
  INPUT_NOT_JSON,
  OUTPUT_NOT_JSON,
  RUN_REPOSITORY_UNAVAILABLE,
  RUN_PERSISTENCE_FAILED,
  ACTION_SUBRUN_LIMIT,
  ACTION_CALL_CYCLE,
} from "../src/runtime/runner";

describe("核心运行时高级防御校验与边缘异常测试套件", () => {
  describe("INPUT_NOT_JSON 防御校验", () => {
    const echoAction = defineAction({
      run: (input: any) => ({ received: input }),
    });

    const createRunner = (packageId: string) => {
      const storage = new SqliteRuntimeStorage({ packageId, dbPath: ":memory:" });
      return new ActionRunner({
        packageId,
        storage,
        actions: new Map([["echo", echoAction]]),
      });
    };

    it("传入 NaN 时防御拦截并返回 INPUT_NOT_JSON 错误", async () => {
      const runner = createRunner("test.nan");
      const res = await runner.execute("echo", { invalidNum: NaN });
      expect(res.ok).toBe(false);
      expect((res as any).error?.code).toBe(INPUT_NOT_JSON);
      expect((res as any).error?.message).toContain("Number is non-finite or NaN");
    });

    it("传入 Infinity 与 -Infinity 时防御拦截并返回 INPUT_NOT_JSON 错误", async () => {
      const runner = createRunner("test.inf");

      const posRes = await runner.execute("echo", { inf: Infinity });
      expect(posRes.ok).toBe(false);
      expect((posRes as any).error?.code).toBe(INPUT_NOT_JSON);
      expect((posRes as any).error?.message).toContain("Number is non-finite or NaN");

      const negRes = await runner.execute("echo", { negInf: -Infinity });
      expect(negRes.ok).toBe(false);
      expect((negRes as any).error?.code).toBe(INPUT_NOT_JSON);
      expect((negRes as any).error?.message).toContain("Number is non-finite or NaN");
    });

    it("传入循环引用对象时防御拦截并返回 INPUT_NOT_JSON 错误", async () => {
      const runner = createRunner("test.circ");
      const circular: any = { name: "loop" };
      circular.self = circular;

      const res = await runner.execute("echo", circular);
      expect(res.ok).toBe(false);
      expect((res as any).error?.code).toBe(INPUT_NOT_JSON);
      expect((res as any).error?.message).toContain("Circular reference detected");
    });

    it("共享子对象的有向无环结构可正常通过校验", async () => {
      const runner = createRunner("test.shared-dag");
      const shared = { id: "shared-node" };
      const dagInput = { a: shared, b: shared, list: [shared, shared] };

      const res = await runner.execute("echo", dagInput);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({ received: dagInput });
      }
    });

    it("共享子对象深度嵌套时仍可正常通过而真实环路仍被拦截", async () => {
      const runner = createRunner("test.shared-dag-deep");
      const sharedLeaf = { value: 42 };
      const input = {
        left: { first: sharedLeaf, second: sharedLeaf },
        right: { first: sharedLeaf, second: sharedLeaf },
      };

      const okRes = await runner.execute("echo", input);
      expect(okRes.ok).toBe(true);

      // 同一对象在自身内部形成真实环路时仍必须被拦截
      const loopHolder: any = { leaf: sharedLeaf };
      loopHolder.self = loopHolder;
      const badRes = await runner.execute("echo", loopHolder);
      expect(badRes.ok).toBe(false);
      expect((badRes as any).error?.code).toBe(INPUT_NOT_JSON);
      expect((badRes as any).error?.message).toContain("Circular reference detected");
    });
  });

  describe("OUTPUT_NOT_JSON 防御校验", () => {
    it("Action 执行产出包含 NaN 时拦截并返回 OUTPUT_NOT_JSON 错误", async () => {
      const nanAction = defineAction({
        run: () => ({ val: NaN }),
      });
      const storage = new SqliteRuntimeStorage({ packageId: "test.out-nan", dbPath: ":memory:" });
      const runner = new ActionRunner({
        packageId: "test.out-nan",
        storage,
        actions: new Map([["nan-action", nanAction]]),
      });

      const res = await runner.execute("nan-action", {});
      expect(res.ok).toBe(false);
      expect((res as any).error?.code).toBe(OUTPUT_NOT_JSON);
      expect((res as any).error?.message).toContain("Number is non-finite or NaN");
    });

    it("Action 执行产出包含 Infinity 时拦截并返回 OUTPUT_NOT_JSON 错误", async () => {
      const infAction = defineAction({
        run: () => ({ val: Infinity }),
      });
      const storage = new SqliteRuntimeStorage({ packageId: "test.out-inf", dbPath: ":memory:" });
      const runner = new ActionRunner({
        packageId: "test.out-inf",
        storage,
        actions: new Map([["inf-action", infAction]]),
      });

      const res = await runner.execute("inf-action", {});
      expect(res.ok).toBe(false);
      expect((res as any).error?.code).toBe(OUTPUT_NOT_JSON);
      expect((res as any).error?.message).toContain("Number is non-finite or NaN");
    });

    it("Action 执行产出包含循环引用对象时拦截并返回 OUTPUT_NOT_JSON 错误", async () => {
      const circularAction = defineAction({
        run: () => {
          const obj: any = { level: 1 };
          obj.child = { parent: obj };
          return obj;
        },
      });
      const storage = new SqliteRuntimeStorage({ packageId: "test.out-circ", dbPath: ":memory:" });
      const runner = new ActionRunner({
        packageId: "test.out-circ",
        storage,
        actions: new Map([["circ-action", circularAction]]),
      });

      const res = await runner.execute("circ-action", {});
      expect(res.ok).toBe(false);
      expect((res as any).error?.code).toBe(OUTPUT_NOT_JSON);
      expect((res as any).error?.message).toContain("Circular reference detected");
    });
  });

  describe("RUN_REPOSITORY_UNAVAILABLE 与 RUN_PERSISTENCE_FAILED 场景", () => {
    const simpleAction = defineAction({
      run: () => ({ success: true }),
    });

    it("当存储层初始化 createRun 失败时抛出 RUN_REPOSITORY_UNAVAILABLE 错误", async () => {
      const faultyStorage = {
        createRun: () => {
          throw new Error("Disk I/O failure or database locked");
        },
        updateRun: () => {},
        listRuns: () => [],
        getRun: () => null,
        getConfig: () => undefined,
        setConfig: () => {},
        deleteConfig: () => false,
        listConfig: () => [],
        getState: () => undefined,
        setState: () => {},
        deleteState: () => false,
        listState: () => [],
        clearState: () => 0,
        close: () => {},
      } as any;

      const runner = new ActionRunner({
        packageId: "test.repo-unavailable",
        actions: new Map([["simple", simpleAction]]),
        storage: faultyStorage,
      });

      try {
        await runner.execute("simple", {});
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe(RUN_REPOSITORY_UNAVAILABLE);
        expect(err.message).toContain("RUN_REPOSITORY_UNAVAILABLE");
      }
    });

    it("当存储层终态 updateRun 失败时返回包含 RUN_PERSISTENCE_FAILED 的错误结果", async () => {
      const memoryStorage = new SqliteRuntimeStorage({ packageId: "test.persist-failed", dbPath: ":memory:" });
      const flakyStorage = {
        createRun: (r: any) => memoryStorage.createRun(r),
        updateRun: () => {
          throw new Error("SQLite disk full on commit");
        },
        listRuns: () => memoryStorage.listRuns(),
        getRun: (id: any) => memoryStorage.getRun(id),
        getConfig: (...args: any[]) => (memoryStorage as any).getConfig(...args),
        setConfig: (...args: any[]) => (memoryStorage as any).setConfig(...args),
        deleteConfig: (...args: any[]) => (memoryStorage as any).deleteConfig(...args),
        listConfig: (...args: any[]) => (memoryStorage as any).listConfig(...args),
        getState: (...args: any[]) => (memoryStorage as any).getState(...args),
        setState: (...args: any[]) => (memoryStorage as any).setState(...args),
        deleteState: (...args: any[]) => (memoryStorage as any).deleteState(...args),
        listState: (...args: any[]) => (memoryStorage as any).listState(...args),
        clearState: (...args: any[]) => (memoryStorage as any).clearState(...args),
        close: () => memoryStorage.close(),
      } as any;

      const runner = new ActionRunner({
        packageId: "test.persist-failed",
        actions: new Map([["simple", simpleAction]]),
        storage: flakyStorage,
      });

      const res = await runner.execute("simple", {});
      expect(res.ok).toBe(false);
      expect((res as any).error?.code).toBe(RUN_PERSISTENCE_FAILED);
      expect((res as any).error?.message).toContain("RUN_PERSISTENCE_FAILED");
    });
  });

  describe("ACTION_SUBRUN_LIMIT 与 ACTION_CALL_CYCLE 场景", () => {
    it("并发子任务超过 activeSubRuns 上限时抛出 ACTION_SUBRUN_LIMIT 错误", async () => {
      let releaseLock!: () => void;
      const gate = new Promise<void>((r) => {
        releaseLock = r;
      });

      const slowChildAction = defineAction({
        run: async () => {
          await gate;
          return { done: true };
        },
      });

      const parentAction = defineAction({
        run: async (_input: unknown, ctx: ActionContext) => {
          const p1 = ctx.actions.invoke("slow-child", {});
          try {
            await ctx.actions.invoke("slow-child", {});
            return { failed: false };
          } catch (err: any) {
            return { failed: true, code: err.code, message: err.message };
          } finally {
            releaseLock();
            await p1;
          }
        },
      });

      const storage = new SqliteRuntimeStorage({ packageId: "test.subrun-limit", dbPath: ":memory:" });
      const runner = new ActionRunner({
        packageId: "test.subrun-limit",
        storage,
        actions: new Map<string, any>([
          ["parent", parentAction],
          ["slow-child", slowChildAction],
        ]),
        maxSubRuns: 1,
      });

      const res = await runner.execute("parent", {});
      expect(res.ok).toBe(true);
      expect((res as any).data?.failed).toBe(true);
      expect((res as any).data?.code).toBe(ACTION_SUBRUN_LIMIT);
      expect((res as any).data?.message).toContain("Maximum concurrent sub-runs");
    });

    it("检测到 Action 互相递归调用成环时拦截并返回 ACTION_CALL_CYCLE 错误", async () => {
      const actionA = defineAction({
        run: async (_input: unknown, ctx: ActionContext) => {
          return await ctx.actions.invoke("action-b", {});
        },
      });

      const actionB = defineAction({
        run: async (_input: unknown, ctx: ActionContext) => {
          return await ctx.actions.invoke("action-a", {});
        },
      });

      const storage = new SqliteRuntimeStorage({ packageId: "test.cycle-detection", dbPath: ":memory:" });
      const runner = new ActionRunner({
        packageId: "test.cycle-detection",
        storage,
        actions: new Map([
          ["action-a", actionA],
          ["action-b", actionB],
        ]),
      });

      const res = await runner.execute("action-a", {});
      expect(res.ok).toBe(false);
      expect((res as any).error?.code).toBe(ACTION_CALL_CYCLE);
      expect((res as any).error?.message).toContain("Cycle detected");
    });
  });

  describe("跨多包短 ID 发现冲突时返回 INVALID_ACTION_REF", () => {
    it("Host 中多个包提供同名短 ID 时抛出 INVALID_ACTION_REF 错误", async () => {
      const calcActionA = defineAction({
        run: () => ({ source: "pkg.math-a", val: 100 }),
      });
      const calcActionB = defineAction({
        run: () => ({ source: "pkg.math-b", val: 200 }),
      });

      const appA = await createActionDockApp({
        projectConfig: {
          id: "pkg.math-a",
          name: "Math Package A",
          actions: { calc: { entry: "", description: "Calc A" } },
        },
        actions: [{ id: "calc", action: calcActionA }],
        inMemory: true,
      });

      const appB = await createActionDockApp({
        projectConfig: {
          id: "pkg.math-b",
          name: "Math Package B",
          actions: { calc: { entry: "", description: "Calc B" } },
        },
        actions: [{ id: "calc", action: calcActionB }],
        inMemory: true,
      });

      const host = await createActionDockHost({
        packages: [appA, appB],
        autoLoadCurrentProject: false,
      });

      // 1. 使用短 ID "calc" 查询存在歧义冲突，返回 INVALID_ACTION_REF
      const resAmbiguous = await host.runAction("calc", {});
      expect(resAmbiguous.ok).toBe(false);
      expect((resAmbiguous as any).error?.code).toBe("INVALID_ACTION_REF");
      expect((resAmbiguous as any).error?.details?.alias).toBe("AMBIGUOUS_ACTION_REF");
      expect((resAmbiguous as any).error?.message).toContain("ambiguous");

      // 2. describeAction 使用歧义短 ID 抛出异常
      try {
        await host.describeAction("calc");
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ACTION_REF");
        expect(err.message).toContain("AMBIGUOUS_ACTION_REF");
      }

      // 3. 明确指定带包名完整限定标识符时正常路由与执行
      const resA = await host.runAction("pkg.math-a/calc", {});
      expect(resA.ok).toBe(true);
      expect(((resA as any).data as any).source).toBe("pkg.math-a");

      const resB = await host.runAction("pkg.math-b/calc", {});
      expect(resB.ok).toBe(true);
      expect(((resB as any).data as any).source).toBe("pkg.math-b");

      await host.close();
    });
  });
});
