import {
  after,
  afterEach,
  before,
  beforeEach,
  describe as nodeDescribe,
  it as nodeIt,
  test as nodeTest,
} from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface TestCallable {
  (name: string, fn: (t?: any) => void | Promise<void>, timeout?: number): void;
  skip: (name: string, fn?: (t?: any) => void | Promise<void>, timeout?: number) => void;
  only: (name: string, fn?: (t?: any) => void | Promise<void>, timeout?: number) => void;
}

export interface DescribeCallable {
  (name: string, fn: () => void | Promise<void>): void;
  skip: (name: string, fn?: () => void | Promise<void>) => void;
  only: (name: string, fn?: () => void | Promise<void>) => void;
}

export const describe: DescribeCallable = nodeDescribe as any;
export const it: TestCallable = nodeIt as any;
export const test: TestCallable = nodeTest as any;
export { beforeEach, afterEach };
export const beforeAll = before;
export const afterAll = after;

declare global {
  var Bun: {
    which(cmd: string): string | null;
    spawnSync(cmdArray: string[], options?: any): any;
    spawn(cmdArray: string[], options?: any): any;
    version?: string;
    serve?: (options: any) => any;
    sqlite?: any;
  };
}

export function setDefaultTimeout(_timeoutMs: number): void {
  // node:test supports test-level timeout, global timeout is a no-op here
}

function findExecutable(command: string): string | null {
  const hasPathSep = command.includes("/") || command.includes("\\");
  if (hasPathSep) {
    return existsSync(command) ? command : null;
  }
  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(delimiter);
  const isWindows = process.platform === "win32";
  const pathext = isWindows
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of pathext) {
      const candidate = join(dir, isWindows ? `${command}${ext}` : command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Shim Bun global in Node environment if absent
if (typeof (globalThis as any).Bun === "undefined") {
  (globalThis as any).Bun = {
    which(cmd: string) {
      return findExecutable(cmd);
    },
    spawnSync(cmdArray: string[], options: any = {}) {
      let [bin, ...args] = cmdArray;
      if (bin === "bun") {
        bin = process.execPath;
      }
      // Windows 兼容：CreateProcess 无法直接执行 .mjs/.js/.ts 脚本（shebang 也不生效），
      // 统一降级为 node <script> 调用
      if (/\.(mjs|cjs|js|ts)$/i.test(bin)) {
        args = [bin, ...args];
        bin = process.execPath;
      }
      const res = spawnSync(bin, args, {
        cwd: options.cwd,
        env: options.env,
        input: options.stdin ?? options.input,
        timeout: options.timeout,
      });
      return {
        // 启动失败（res.error）时 status/signal 均为 null，必须显式置为失败，
        // 否则错误被掩码成 exitCode 0 + 空 stdout
        exitCode: res.error ? 1 : res.status ?? (res.signal ? 1 : 0),
        stdout: Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout || ""),
        stderr: Buffer.isBuffer(res.stderr) ? res.stderr : Buffer.from(res.stderr || ""),
        signalCode: res.signal,
      };
    },
    spawn(cmdArray: string[], options: any = {}) {
      let [bin, ...args] = cmdArray;
      if (bin === "bun") {
        bin = process.execPath;
      }
      if (/\.(mjs|cjs|js|ts)$/i.test(bin)) {
        args = [bin, ...args];
        bin = process.execPath;
      }
      const proc = spawn(bin, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: options.stdio ?? [
          options.stdin ? "pipe" : "ignore",
          options.stdout ?? "pipe",
          options.stderr ?? "pipe",
        ],
        detached: options.detached ?? (process.platform !== "win32"),
      });
      const exited = new Promise<number>((resolve) => {
        proc.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
        proc.on("error", () => resolve(1));
      });
      (proc as any).exited = exited;
      const originalKill = proc.kill.bind(proc);
      (proc as any).kill = (signal: any = "SIGTERM") => {
        if (proc.pid && process.platform !== "win32") {
          try {
            process.kill(-proc.pid, signal);
          } catch {
            // Process group may have already exited
          }
        }
        return originalKill(signal);
      };
      return proc;
    },
  };
}

function createExpectation(actual: any, isNot = false): any {
  return {
    get not() {
      return createExpectation(actual, !isNot);
    },
    get rejects() {
      const rejectedPromise = (async () => {
        try {
          await actual;
        } catch (err) {
          return err;
        }
        throw new assert.AssertionError({
          message: "Expected promise to be rejected, but it resolved successfully",
        });
      })();

      return new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "toThrow" || prop === "toThrowError") {
              return async (expected?: any) => {
                if (isNot) {
                  await assert.doesNotReject(actual);
                } else {
                  if (typeof expected === "string") {
                    await assert.rejects(actual, (err: any) =>
                      String(err?.message || err).includes(expected)
                    );
                  } else if (expected instanceof RegExp) {
                    await assert.rejects(actual, expected);
                  } else if (expected) {
                    await assert.rejects(actual, expected);
                  } else {
                    await assert.rejects(actual);
                  }
                }
              };
            }
            return async (...args: any[]) => {
              const err = await rejectedPromise;
              const matchers = createExpectation(err, isNot);
              return matchers[prop](...args);
            };
          },
        }
      );
    },
    get resolves() {
      const resolvedPromise = (async () => {
        return await actual;
      })();

      return new Proxy(
        {},
        {
          get(_target, prop) {
            return async (...args: any[]) => {
              const val = await resolvedPromise;
              const matchers = createExpectation(val, isNot);
              return matchers[prop](...args);
            };
          },
        }
      );
    },
    toBe(expected: any) {
      if (isNot) {
        assert.notStrictEqual(actual, expected);
      } else {
        assert.strictEqual(actual, expected);
      }
    },
    toEqual(expected: any) {
      if (isNot) {
        assert.notDeepStrictEqual(actual, expected);
      } else {
        assert.deepStrictEqual(actual, expected);
      }
    },
    toStrictEqual(expected: any) {
      if (isNot) {
        assert.notDeepStrictEqual(actual, expected);
      } else {
        assert.deepStrictEqual(actual, expected);
      }
    },
    toBeTruthy() {
      if (isNot) {
        assert.ok(!actual, `Expected ${actual} to be falsy`);
      } else {
        assert.ok(actual, `Expected ${actual} to be truthy`);
      }
    },
    toBeFalsy() {
      if (isNot) {
        assert.ok(actual, `Expected ${actual} to be truthy`);
      } else {
        assert.ok(!actual, `Expected ${actual} to be falsy`);
      }
    },
    toBeNull() {
      if (isNot) {
        assert.notStrictEqual(actual, null);
      } else {
        assert.strictEqual(actual, null);
      }
    },
    toBeUndefined() {
      if (isNot) {
        assert.notStrictEqual(actual, undefined);
      } else {
        assert.strictEqual(actual, undefined);
      }
    },
    toBeDefined() {
      if (isNot) {
        assert.strictEqual(actual, undefined);
      } else {
        assert.notStrictEqual(actual, undefined);
      }
    },
    toContain(item: any) {
      let contains = false;
      if (typeof actual === "string") {
        contains = actual.includes(item);
      } else if (Array.isArray(actual)) {
        contains = actual.includes(item);
      } else if (actual instanceof Set) {
        contains = actual.has(item);
      } else if (actual instanceof Map) {
        contains = actual.has(item);
      } else if (actual && typeof actual === "object") {
        contains = item in actual || Object.values(actual).includes(item);
      }
      if (isNot) {
        assert.ok(!contains, `Expected collection not to contain ${JSON.stringify(item)}`);
      } else {
        assert.ok(contains, `Expected collection to contain ${JSON.stringify(item)}`);
      }
    },
    toBeGreaterThan(n: number) {
      if (isNot) {
        assert.ok(actual <= n, `Expected ${actual} <= ${n}`);
      } else {
        assert.ok(actual > n, `Expected ${actual} > ${n}`);
      }
    },
    toBeGreaterThanOrEqual(n: number) {
      if (isNot) {
        assert.ok(actual < n, `Expected ${actual} < ${n}`);
      } else {
        assert.ok(actual >= n, `Expected ${actual} >= ${n}`);
      }
    },
    toBeLessThan(n: number) {
      if (isNot) {
        assert.ok(actual >= n, `Expected ${actual} >= ${n}`);
      } else {
        assert.ok(actual < n, `Expected ${actual} < ${n}`);
      }
    },
    toBeLessThanOrEqual(n: number) {
      if (isNot) {
        assert.ok(actual > n, `Expected ${actual} > ${n}`);
      } else {
        assert.ok(actual <= n, `Expected ${actual} <= ${n}`);
      }
    },
    toBeInstanceOf(cls: any) {
      if (isNot) {
        assert.ok(!(actual instanceof cls), `Expected not to be instance of ${cls.name}`);
      } else {
        assert.ok(actual instanceof cls, `Expected to be instance of ${cls.name}`);
      }
    },
    toHaveLength(len: number) {
      const actualLen = actual?.length ?? actual?.size;
      if (isNot) {
        assert.notStrictEqual(actualLen, len);
      } else {
        assert.strictEqual(actualLen, len);
      }
    },
    toMatch(pattern: string | RegExp) {
      const str = String(actual);
      if (pattern instanceof RegExp) {
        if (isNot) {
          assert.doesNotMatch(str, pattern);
        } else {
          assert.match(str, pattern);
        }
      } else {
        if (isNot) {
          assert.ok(!str.includes(pattern));
        } else {
          assert.ok(str.includes(pattern));
        }
      }
    },
    toThrow(expected?: any) {
      if (typeof actual !== "function") {
        throw new Error("actual must be a function for toThrow");
      }
      if (isNot) {
        assert.doesNotThrow(actual);
      } else {
        if (typeof expected === "string") {
          assert.throws(actual, (err: any) => String(err?.message || err).includes(expected));
        } else if (expected instanceof RegExp) {
          assert.throws(actual, expected);
        } else if (expected) {
          assert.throws(actual, expected);
        } else {
          assert.throws(actual);
        }
      }
    },
    toThrowError(expected?: any) {
      return this.toThrow(expected);
    },
  };
}

export function expect(actual: any): any {
  return createExpectation(actual, false);
}
