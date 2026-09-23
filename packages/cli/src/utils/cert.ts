import { X509Certificate, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  getActionDockHome,
} from "@actiondock/core/registry";
import { generate } from "selfsigned";

/**
 * 证书与私钥数据对。
 */
export interface CertificatePair {
  /** 证书 PEM 文本内容 */
  cert: string;
  /** 私钥 PEM 文本内容 */
  key: string;
  /** 证书物理文件路径 */
  certPath: string;
  /** 私钥物理文件路径 */
  keyPath: string;
}

/**
 * 判定字符串是否为有效 IPv4 或 IPv6 地址。
 */
function isIpAddress(str: string): boolean {
  return isIP(str) !== 0;
}

/**
 * 收集自签名证书所需的 SAN (Subject Alternative Name) 扩展项列表。
 * 全面支持 localhost、127.0.0.1、::1、系统主机名以及绑定 0.0.0.0 时的本机局域网 IP。
 */
export function collectSanEntries(bindHost?: string): Array<{ type: 2 | 7; value?: string; ip?: string }> {
  const dnsSet = new Set<string>();
  const ipSet = new Set<string>();

  // 基础回环名称与 IP
  dnsSet.add("localhost");
  ipSet.add("127.0.0.1");
  ipSet.add("::1");

  // 系统主机名
  const sysHostname = hostname();
  if (sysHostname) {
    if (isIpAddress(sysHostname)) {
      ipSet.add(sysHostname);
    } else {
      dnsSet.add(sysHostname);
    }
  }

  // 显式指定的主机地址
  if (bindHost && bindHost !== "0.0.0.0" && bindHost !== "::") {
    if (isIpAddress(bindHost)) {
      ipSet.add(bindHost);
    } else {
      dnsSet.add(bindHost);
    }
  }

  // 当绑定 0.0.0.0 或未指定时，枚举全部本机网络接口地址
  if (!bindHost || bindHost === "0.0.0.0" || bindHost === "::") {
    const interfaces = networkInterfaces();
    for (const ifaceList of Object.values(interfaces)) {
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        if (!iface.address) continue;
        let addr = iface.address;
        const percentIdx = addr.indexOf("%");
        if (percentIdx !== -1) {
          addr = addr.slice(0, percentIdx);
        }
        ipSet.add(addr);
      }
    }
  }

  const entries: Array<{ type: 2 | 7; value?: string; ip?: string }> = [];
  for (const dns of dnsSet) {
    entries.push({ type: 2, value: dns });
  }
  for (const ip of ipSet) {
    entries.push({ type: 7, ip });
  }
  return entries;
}

/**
 * 校验证书是否在有效期内且剩余天数大于设定阈值。
 */
export function isCertificateValid(certPem: string, minRemainingDays: number = 7): boolean {
  try {
    const x509 = new X509Certificate(certPem);
    const validToMs = new Date(x509.validTo).getTime();
    const minRemainingMs = minRemainingDays * 24 * 60 * 60 * 1000;
    return validToMs - Date.now() > minRemainingMs;
  } catch {
    return false;
  }
}

/**
 * 校验证书是否涵盖目标主机名或 IP 地址。
 * 读取 X509 证书的 subjectAltName，检验当前绑定主机是否已被该证书覆盖。
 *
 * @param certPem 证书 PEM 文本
 * @param host 待校验的目标主机名或 IP 地址
 */
export function certificateCoversHost(certPem: string, host?: string): boolean {
  try {
    const x509 = new X509Certificate(certPem);
    const san = x509.subjectAltName;
    if (!san) {
      return false;
    }

    const dnsNames = new Set<string>();
    const ipAddresses = new Set<string>();

    const parts = san.split(",").map((s) => s.trim());
    for (const part of parts) {
      if (part.startsWith("DNS:")) {
        dnsNames.add(part.slice(4).trim().toLowerCase());
      } else if (part.startsWith("IP Address:")) {
        ipAddresses.add(part.slice(11).trim().toLowerCase());
      }
    }

    // 基础回环覆盖检查
    if (!dnsNames.has("localhost") || !ipAddresses.has("127.0.0.1")) {
      return false;
    }

    // 若未显式指定主机，或指定为通配地址，需保证所有当前活动网卡 IP 均已被覆盖
    if (!host || host === "0.0.0.0" || host === "::") {
      const interfaces = networkInterfaces();
      for (const ifaceList of Object.values(interfaces)) {
        if (!ifaceList) continue;
        for (const iface of ifaceList) {
          if (!iface.address) continue;
          let addr = iface.address.toLowerCase();
          const percentIdx = addr.indexOf("%");
          if (percentIdx !== -1) {
            addr = addr.slice(0, percentIdx);
          }
          if (!ipAddresses.has(addr)) {
            return false;
          }
        }
      }
      return true;
    }

    const trimmedHost = host.trim().toLowerCase();
    if (isIpAddress(trimmedHost)) {
      return ipAddresses.has(trimmedHost);
    }

    return dnsNames.has(trimmedHost);
  } catch {
    return false;
  }
}

/**
 * 自动加载或重新签发自签名证书。
 * 遵循严格的存储路径规范、有效性校验与原子文件写入机制。
 */
export async function ensureSelfSignedCertificate(options?: {
  customHome?: string;
  host?: string;
}): Promise<CertificatePair> {
  const baseHome = getActionDockHome(options?.customHome);
  const certDir = join(baseHome, ".actiondock", "certs");
  const certPath = join(certDir, "localhost.crt");
  const keyPath = join(certDir, "localhost.key");

  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath, "utf-8");
      const key = readFileSync(keyPath, "utf-8");
      if (isCertificateValid(cert, 7) && certificateCoversHost(cert, options?.host)) {
        return { cert, key, certPath, keyPath };
      }
    } catch {
      // 忽略读取失败并触发重新签发
    }
  }

  mkdirSync(certDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(certDir, 0o700);
  } catch {
    // 忽略不支持 chmod 的环境
  }

  const altNames = collectSanEntries(options?.host);
  const notAfterDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const pems = await generate(
    [{ name: "commonName", value: "localhost" }],
    {
      notAfterDate,
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        {
          name: "subjectAltName",
          altNames,
        },
      ],
    }
  );

  const nonce = `${Date.now()}.${randomUUID()}`;
  const tmpKeyPath = join(certDir, `localhost.key.tmp.${nonce}`);
  const tmpCertPath = join(certDir, `localhost.crt.tmp.${nonce}`);

  writeFileSync(tmpKeyPath, pems.private, { encoding: "utf-8", mode: 0o600 });
  try {
    chmodSync(tmpKeyPath, 0o600);
  } catch {
    // 忽略不支持 chmod 的环境
  }

  writeFileSync(tmpCertPath, pems.cert, { encoding: "utf-8", mode: 0o644 });

  renameSync(tmpKeyPath, keyPath);
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // 忽略不支持 chmod 的环境
  }

  renameSync(tmpCertPath, certPath);

  return {
    cert: pems.cert,
    key: pems.private,
    certPath,
    keyPath,
  };
}
