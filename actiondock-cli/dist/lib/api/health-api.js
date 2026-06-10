import { isRecord } from "../error.js";
export class HealthApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async health() {
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
