import { resolve } from "node:path";
import { loadProjectConfig, type ConfigValueView } from "@actiondock/core";
import { fetchRemoteConfig, fetchRemoteConfigItem } from "@actiondock/core/profile";
import type { ConfigItemDefinition } from "@actiondock/core/project";
import { resolveLocalPackageRoot } from "../../utils";

export interface RemoteConfigSafeResult {
  items: ConfigValueView[];
  declared?: Record<string, ConfigItemDefinition>;
  packageId?: string;
}

/** 将显式本地路径转换为远端包标识；当前目录只能提供候选声明，不能改选目标。 */
export function resolveRemoteConfigScope(options: { package?: string; global?: boolean }) {
  let packageId = options.global ? "global" : options.package;
  let localDeclarations: Record<string, ConfigItemDefinition> | undefined;
  let localPackageId: string | undefined;
  if (!options.global) {
    const root = resolveLocalPackageRoot(options.package);
    if (root) {
      const manifest = loadProjectConfig(root);
      if (!options.package || manifest.id === options.package || resolve(options.package) === resolve(root)) {
        localDeclarations = manifest.config;
        localPackageId = manifest.id;
        // 仅显式本地路径转换为包标识，不能用当前目录偷偷改选远端默认包。
        if (options.package) packageId = manifest.id;
      }
    }
  }
  return { packageId, localDeclarations, localPackageId };
}

/** 只向核心客户端提供作用域和本地声明，CLI 不再解析远端敏感性或重复掩码。 */
export async function fetchRemoteConfigSafe(
  target: { serverUrl?: string; token?: string; insecure?: boolean },
  options: { package?: string; global?: boolean; key?: string; allowInsecureHttp?: boolean }
): Promise<RemoteConfigSafeResult> {
  const { packageId, localDeclarations, localPackageId } = resolveRemoteConfigScope(options);
  const requestOptions = {
    allowInsecureHttp: options.allowInsecureHttp,
    insecure: target.insecure,
    localDeclarations,
    localPackageId,
  };
  const response = options.key
    ? await fetchRemoteConfigItem(target.serverUrl!, options.key, target.token, packageId, requestOptions)
    : await fetchRemoteConfig(target.serverUrl!, target.token, packageId, requestOptions);
  return { items: response.items, declared: response.declared, packageId: response.packageId };
}
