/**
 * ActionDock 内置 Bun 核心类型定义兜底
 *
 * 用于解耦对外部 npm 镜像源中 @types/bun / bun-types 的硬性解析依赖，
 * 避免在内网私有源、npm 工作区提升失效或无网络环境下执行 tsc 报 TS2688 或缺少类型错误。
 */

declare module "bun:sqlite" {
  export interface DatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
    strict?: boolean;
    safeintegers?: boolean;
  }

  export class Database {
    constructor(filename?: string, options?: number | DatabaseOptions);
    exec(sql: string): void;
    prepare(sql: string): any;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
  }
}

declare module "bun" {
  export interface Server<T = unknown> {
    readonly port: number;
    readonly hostname: string;
    readonly url: URL;
    stop(closeActiveConnections?: boolean): void;
  }

  export interface ServeOptions {
    port?: number;
    hostname?: string;
    development?: boolean;
    maxRequestBodySize?: number;
    fetch: (request: Request, server: Server) => Response | Promise<Response>;
    error?: (error: Error) => Response | Promise<Response> | undefined;
  }
}

declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export namespace describe {
    export function skip(name: string, fn: () => void | Promise<void>): void;
    export function only(name: string, fn: () => void | Promise<void>): void;
  }
  export function test(name: string, fn: () => void | Promise<void>, timeout?: number): void;
  export namespace test {
    export function skip(name: string, fn: () => void | Promise<void>, timeout?: number): void;
    export function only(name: string, fn: () => void | Promise<void>, timeout?: number): void;
  }
  export const it: typeof test;
  export function expect(actual: any): any;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function setDefaultTimeout(timeout: number): void;
}

declare namespace Bun {
  export function serve(options: any): any;
  export function spawn(command: string[], options?: any): any;
  export function spawnSync(command: string[], options?: any): any;
  export function which(command: string): string | null;
  export const version: string;
  export const sqlite: any;
}
