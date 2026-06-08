import { querySuffix } from "./query-suffix.js";
export class PresetApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list(scriptId, intent) {
        const suffix = querySuffix({ intent });
        return this.transport.requestJson(`/api/scripts/${scriptId}/presets${suffix}`);
    }
    async create(scriptId, payload) {
        return this.transport.requestJson(`/api/scripts/${scriptId}/presets`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async update(scriptId, presetId, payload) {
        return this.transport.requestJson(`/api/scripts/${scriptId}/presets/${presetId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async delete(scriptId, presetId) {
        await this.transport.requestJson(`/api/scripts/${scriptId}/presets/${presetId}`, {
            method: "DELETE"
        });
    }
}
