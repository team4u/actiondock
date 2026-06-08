import { querySuffix } from "./query-suffix.js";
export class ConfigValueApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list(intent) {
        const suffix = querySuffix({ intent });
        return this.transport.requestJson(`/api/config-values${suffix}`);
    }
    async get(key) {
        return this.transport.requestJson(`/api/config-values/${encodeURIComponent(key)}`);
    }
    async create(payload) {
        return this.transport.requestJson("/api/config-values", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async update(key, payload) {
        return this.transport.requestJson(`/api/config-values/${encodeURIComponent(key)}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async copyLocalOverride(key) {
        return this.transport.requestJson(`/api/config-values/${encodeURIComponent(key)}/copy-local-override`, {
            method: "POST"
        });
    }
    async restoreRepositoryDefault(key) {
        return this.transport.requestJson(`/api/config-values/${encodeURIComponent(key)}/restore-repository-default`, {
            method: "POST"
        });
    }
    async delete(key) {
        await this.transport.requestJson(`/api/config-values/${encodeURIComponent(key)}`, {
            method: "DELETE"
        });
    }
}
