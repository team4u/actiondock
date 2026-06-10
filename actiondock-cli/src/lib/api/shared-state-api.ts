import { HttpTransport } from "./http-transport.js";
import type {
  SharedStateCompareAndSetRequest,
  SharedStateCompareAndSetResult,
  SharedStateDetail,
  SharedStateRequest,
  SharedStateSummary
} from "../types.js";

export class SharedStateApi {
  constructor(private readonly transport: HttpTransport) {}

  async put(payload: SharedStateRequest): Promise<SharedStateDetail> {
    return this.transport.requestJson<SharedStateDetail>("/api/shared-state", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async listNamespaces(): Promise<string[]> {
    return this.transport.requestJson<string[]>("/api/shared-state/namespaces");
  }

  async list(namespace: string): Promise<SharedStateSummary[]> {
    return this.transport.requestJson<SharedStateSummary[]>(`/api/shared-state?${new URLSearchParams({ namespace }).toString()}`);
  }

  async get(namespace: string, key: string): Promise<SharedStateDetail> {
    return this.transport.requestJson<SharedStateDetail>(
      `/api/shared-state/detail?${new URLSearchParams({ namespace, key }).toString()}`
    );
  }

  async compareAndSet(payload: SharedStateCompareAndSetRequest): Promise<SharedStateCompareAndSetResult> {
    return this.transport.requestJson<SharedStateCompareAndSetResult>("/api/shared-state/cas", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async delete(namespace: string, key: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/shared-state?${new URLSearchParams({ namespace, key }).toString()}`, {
      method: "DELETE"
    });
  }

  async purgeExpired(namespace?: string): Promise<number> {
    const suffix = namespace ? `?${new URLSearchParams({ namespace }).toString()}` : "";
    return this.transport.requestJson<number>(`/api/shared-state/purge-expired${suffix}`, {
      method: "POST"
    });
  }
}
