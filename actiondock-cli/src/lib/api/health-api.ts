import { HttpTransport } from "./http-transport.js";
import type { HealthView } from "../types.js";
import { isRecord } from "../error.js";

export class HealthApi {
  constructor(private readonly transport: HttpTransport) {}

  async health(): Promise<HealthView> {
    const payload = await this.transport.requestRawJson("/actuator/health");
    const status = isRecord(payload) && typeof payload.status === "string" ? payload.status : undefined;
    return {
      ok: status === "UP",
      server: this.transport.serverUrl,
      status,
      details: payload
    };
  }
}
