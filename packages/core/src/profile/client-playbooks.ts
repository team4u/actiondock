import type { RemoteClientRequestOptions } from "./client-transport";
import { buildQueryString, fetchRemoteJson } from "./client-query";

/**
 * 远端 Playbook 规程域端点。
 */

/**
 * 拉取远端 Playbook 列表（可按意图与包名过滤）。
 */
export async function fetchRemotePlaybooks(
  serverUrl: string,
  token?: string,
  options?: { intent?: string; package?: string } & RemoteClientRequestOptions
): Promise<Array<{ id: string; description: string; actions: string[]; packageId: string; filePath: string }>> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/playbooks${buildQueryString({
      intent: options?.intent,
      package: options?.package,
    })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote playbooks",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemotePlaybookShow(
  playbookId: string,
  token?: string,
  options?: RemoteClientRequestOptions
): Promise<any>;
export async function fetchRemotePlaybookShow(
  serverUrl: string,
  playbookId: string,
  token?: string,
  options?: RemoteClientRequestOptions
): Promise<any>;
export async function fetchRemotePlaybookShow(
  serverUrlOrPlaybookId: string,
  playbookIdOrToken?: string,
  tokenOrOptions?: string | RemoteClientRequestOptions,
  optionsArg?: RemoteClientRequestOptions
): Promise<any> {
  let serverUrl = serverUrlOrPlaybookId;
  let playbookId = playbookIdOrToken || "";
  let token: string | undefined;
  let options: RemoteClientRequestOptions | undefined = optionsArg;

  if (typeof tokenOrOptions === "object") {
    options = tokenOrOptions;
  } else if (typeof tokenOrOptions === "string") {
    token = tokenOrOptions;
  }

  return fetchRemoteJson(
    serverUrl,
    `/api/v2/playbooks/${encodeURIComponent(playbookId)}`,
    token,
    {
      errorPrefix: `Failed to fetch remote playbook '${playbookId}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}
