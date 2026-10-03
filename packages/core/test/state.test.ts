import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPackageRuntime } from "../src/package";
import { DefaultPackageRuntime } from "../src/package/runtime";

describe("状态消歧与显式空作用域", () => {
  it("四参数 setState 第四参为 undefined 时正确识别为 Action 状态写入", async () => {
    const runtime = await createPackageRuntime({
      projectConfig: {
        id: "test.state.four-args",
        name: "Four Args Test",
        version: "1.0.0",
      },
      inMemory: true,
    });

    try {
      // 写入四参数形态，但第四实参显式传入 undefined
      await runtime.setState("worker", "counter", { count: 7 }, undefined);

      // 验证 Action 命名空间状态写入成功
      const actionState = await runtime.getActionState<{ count: number }>("worker", "counter");
      assert.deepStrictEqual(actionState, { count: 7 });

      const scopedState = await runtime.getState<{ count: number }>("worker", "counter");
      assert.deepStrictEqual(scopedState, { count: 7 });

      // 验证未被误判为三参数扁平状态（第一参不是键名，第二参不是键值）
      const rootKeyVal = await runtime.getActionState("", "worker");
      assert.strictEqual(rootKeyVal, undefined);

      const workerAsKey = await runtime.getState("worker");
      assert.notStrictEqual(workerAsKey, "counter");
    } finally {
      await runtime.close();
    }
  });

  it("DefaultPackageRuntime 实例同样支持四参数 undefined 第四参写入 Action 状态", async () => {
    const concreteRuntime = new DefaultPackageRuntime({ inMemory: true });
    try {
      await concreteRuntime.setState("worker", "counter", { count: 7 }, undefined);

      const actionState = await concreteRuntime.getActionState<{ count: number }>("worker", "counter");
      assert.deepStrictEqual(actionState, { count: 7 });

      const rootKeyVal = await concreteRuntime.getActionState("", "worker");
      assert.strictEqual(rootKeyVal, undefined);
    } finally {
      await concreteRuntime.close();
    }
  });

  it("显式空作用域 getActionState 严格限定在根命名空间，绝不回退跨命名空间模糊搜索", async () => {
    const runtime = await createPackageRuntime({
      projectConfig: {
        id: "test.state.empty-scope",
        name: "Empty Scope Test",
        version: "1.0.0",
      },
      inMemory: true,
    });

    try {
      // 在多个不同的 Action 命名空间写入同名状态
      await runtime.setActionState("worker-a", "isolated", "val-a");
      await runtime.setActionState("worker-b", "isolated", "val-b");

      // 显式空串作用域查询根命名空间状态：根命名空间无此状态时必须返回 undefined，绝对不能返回其他 Action 的同名状态或抛出多匹配异常
      const rootState = await runtime.getActionState("", "isolated");
      assert.strictEqual(rootState, undefined);

      // options.detail 场景同样严格限定在根命名空间
      const detailEntry = await runtime.getActionState("", "isolated", { detail: true });
      assert.strictEqual(detailEntry, undefined);

      // 向根命名空间显式写入状态
      await runtime.setActionState("", "isolated", "root-isolated-value");

      // 再次查询根命名空间，严格返回根命名空间的值
      const rootStateAfter = await runtime.getActionState<string>("", "isolated");
      assert.strictEqual(rootStateAfter, "root-isolated-value");

      // 各 Action 的命名空间隔离性不受影响
      assert.strictEqual(await runtime.getActionState("worker-a", "isolated"), "val-a");
      assert.strictEqual(await runtime.getActionState("worker-b", "isolated"), "val-b");
    } finally {
      await runtime.close();
    }
  });

  it("显式空作用域 setActionState 严格保留冒号字面键，不拆分为命名空间", async () => {
    const runtime = await createPackageRuntime({
      projectConfig: {
        id: "test.state.literal-colon",
        name: "Literal Colon Test",
        version: "1.0.0",
      },
      inMemory: true,
    });

    try {
      const payload = { configId: "sub:123", active: true };
      // 显式以空作用域写入带有冒号的字面键名
      await runtime.setActionState("", "literal:key", payload);

      // 读取字面键名，必须完整命中
      const retrieved = await runtime.getActionState<typeof payload>("", "literal:key");
      assert.deepStrictEqual(retrieved, payload);

      // 验证未被拆分到 literal 命名空间下的 key
      const splitState = await runtime.getActionState("literal", "key");
      assert.strictEqual(splitState, undefined);

      // 验证 listStateKeys 在显式空作用域下只返回根作用域下的键
      const rootKeys = await runtime.listStateKeys("");
      assert.ok(rootKeys.includes("literal:key"));
      assert.ok(!rootKeys.includes("key"));

      // 验证显式空作用域删除
      const deleted = await runtime.deleteActionState("", "literal:key");
      assert.strictEqual(deleted, true);

      const afterDelete = await runtime.getActionState("", "literal:key");
      assert.strictEqual(afterDelete, undefined);
    } finally {
      await runtime.close();
    }
  });

  it("显式空作用域 clearState 仅清空根命名空间，不波及其他 Action 状态", async () => {
    const runtime = await createPackageRuntime({
      projectConfig: {
        id: "test.state.clear-scope",
        name: "Clear Scope Test",
        version: "1.0.0",
      },
      inMemory: true,
    });

    try {
      await runtime.setActionState("", "root-item-1", 1);
      await runtime.setActionState("", "root-item-2", 2);
      await runtime.setActionState("worker", "worker-item", 99);

      // 清空显式空作用域
      const cleared = await runtime.clearState("");
      assert.strictEqual(cleared, 2);

      // 根命名空间已清空
      assert.strictEqual(await runtime.getActionState("", "root-item-1"), undefined);
      assert.strictEqual(await runtime.getActionState("", "root-item-2"), undefined);

      // worker 命名空间状态完好保留
      assert.strictEqual(await runtime.getActionState("worker", "worker-item"), 99);
    } finally {
      await runtime.close();
    }
  });

  it("带 all: true 选项时 clearState 彻底清空整个包的所有状态（覆盖根命名空间与全部 Action 状态）", async () => {
    const runtime = await createPackageRuntime({
      projectConfig: {
        id: "test.state.clear-all",
        name: "Clear All Test",
        version: "1.0.0",
      },
      inMemory: true,
    });

    try {
      await runtime.setActionState("", "root-item", "root-value");
      await runtime.setActionState("worker", "worker-item", "worker-value");
      await runtime.setActionState("reporter", "report-item", "report-value");

      assert.strictEqual(await runtime.getActionState("", "root-item"), "root-value");
      assert.strictEqual(await runtime.getActionState("worker", "worker-item"), "worker-value");
      assert.strictEqual(await runtime.getActionState("reporter", "report-item"), "report-value");

      // 当 options.all 为 true 时，即使传入空串 actionId，也必须覆盖作用域并清空全包所有状态
      const cleared = await runtime.clearState("", { all: true });
      assert.strictEqual(cleared, 3);

      assert.strictEqual(await runtime.getActionState("", "root-item"), undefined);
      assert.strictEqual(await runtime.getActionState("worker", "worker-item"), undefined);
      assert.strictEqual(await runtime.getActionState("reporter", "report-item"), undefined);

      const remainingKeys = await runtime.listStateKeys();
      assert.deepStrictEqual(remainingKeys, []);
    } finally {
      await runtime.close();
    }
  });

  it("严格区分未指定 actionId 与显式空作用域的状态列表查询", async () => {
    const runtime = await createPackageRuntime({
      projectConfig: {
        id: "test.state.list-scope",
        name: "List Scope Test",
        version: "1.0.0",
      },
      inMemory: true,
    });

    try {
      await runtime.setActionState("", "root-item", "root-val");
      await runtime.setActionState("worker", "worker-item", "worker-val");

      // 未指定 actionId（actionId 为 undefined）：查询全包所有状态
      const allKeys = await runtime.listStateKeys();
      assert.ok(allKeys.includes("root-item"));
      assert.ok(allKeys.includes("worker:worker-item"));

      // 显式传入 undefined 与前缀选项：依然查询全包所有状态
      const allKeysWithUndefined = await runtime.listStateKeys(undefined, { prefix: "" });
      assert.ok(allKeysWithUndefined.includes("root-item"));
      assert.ok(allKeysWithUndefined.includes("worker:worker-item"));

      // 显式空作用域（actionId 为空串）：仅查询根命名空间状态
      const rootOnlyKeys = await runtime.listStateKeys("");
      assert.ok(rootOnlyKeys.includes("root-item"));
      assert.ok(!rootOnlyKeys.includes("worker:worker-item"));

      // 显式 Action 作用域：仅查询对应 Action 状态（返回相对于 Action 命名空间的键名）
      const workerKeys = await runtime.listStateKeys("worker");
      assert.ok(!workerKeys.includes("root-item"));
      assert.ok(workerKeys.includes("worker-item"));
    } finally {
      await runtime.close();
    }
  });
});
