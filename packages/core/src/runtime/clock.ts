/**
 * 时钟契约单一事实源已下沉至 storage/clock.ts（基础契约层）。
 *
 * 此处 re-export 维持 `runtime/clock` 与 `@actiondock/core` 根入口的既有
 * 导入路径兼容，外部消费方无需变更。
 */
export { type Clock, SystemClock } from "../storage/clock";
