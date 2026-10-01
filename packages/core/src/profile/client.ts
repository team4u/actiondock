/**
 * 远端客户端兼容出口。
 *
 * 客户端实现已收敛至 `packages/core/src/client/`(按资源域组织、传输层单点),
 * 此处仅保留对历史公共路径 `@actiondock/core/profile` 的兼容 re-export。
 */

export * from "../client";
