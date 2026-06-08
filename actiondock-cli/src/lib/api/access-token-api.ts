import { HttpTransport } from "./http-transport.js";
import type { AccessTokenView } from "../types.js";

export class AccessTokenApi {
  constructor(private readonly transport: HttpTransport) {}

  async list(): Promise<AccessTokenView[]> {
    return this.transport.requestJson<AccessTokenView[]>("/api/access-tokens");
  }

  async create(name?: string): Promise<AccessTokenView> {
    return this.transport.requestJson<AccessTokenView>("/api/access-tokens", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }

  async rename(tokenId: string, name?: string): Promise<AccessTokenView> {
    return this.transport.requestJson<AccessTokenView>(`/api/access-tokens/${tokenId}`, {
      method: "PUT",
      body: JSON.stringify({ name })
    });
  }

  async enable(tokenId: string): Promise<AccessTokenView> {
    return this.transport.requestJson<AccessTokenView>(`/api/access-tokens/${tokenId}/enable`, {
      method: "POST"
    });
  }

  async disable(tokenId: string): Promise<AccessTokenView> {
    return this.transport.requestJson<AccessTokenView>(`/api/access-tokens/${tokenId}/disable`, {
      method: "POST"
    });
  }

  async delete(tokenId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/access-tokens/${tokenId}`, {
      method: "DELETE"
    });
  }
}
