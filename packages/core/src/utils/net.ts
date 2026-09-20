/**
 * 检查指定的主机地址是否为本地回环接口（Loopback Host）。
 * 支持 127.0.0.1, localhost, ::1 等形式。
 *
 * 本函数为跨域通用谓词单一事实源：客户端域（profile）与服务端域（server）
 * 共同引用，故置于 utils 通用层；server/security.ts 保留 re-export 兼容旧引用路径。
 *
 * @param host 主机名或 IP 字符串
 */
export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    trimmed === "127.0.0.1" ||
    trimmed === "::1" ||
    trimmed === "localhost" ||
    trimmed === "0:0:0:0:0:0:0:1"
  );
}
