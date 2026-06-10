export class PlaybookApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list(params = {}) {
        const search = new URLSearchParams();
        if (params.repositoryId)
            search.set("repositoryId", params.repositoryId);
        if (params.tag)
            search.set("tag", params.tag);
        if (params.enabled !== undefined)
            search.set("enabled", String(params.enabled));
        if (params.managed !== undefined)
            search.set("managed", String(params.managed));
        if (params.intent)
            search.set("intent", params.intent);
        const suffix = search.toString() ? `?${search.toString()}` : "";
        return this.transport.requestJson(`/api/playbooks${suffix}`);
    }
    async get(playbookId) {
        return this.transport.requestJson(`/api/playbooks/${playbookId}`);
    }
    async create(payload) {
        return this.transport.requestJson("/api/playbooks", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async update(playbookId, payload) {
        return this.transport.requestJson(`/api/playbooks/${playbookId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async delete(playbookId) {
        await this.transport.requestJson(`/api/playbooks/${playbookId}`, {
            method: "DELETE"
        });
    }
}
