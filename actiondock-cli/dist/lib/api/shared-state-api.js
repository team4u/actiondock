export class SharedStateApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async put(payload) {
        return this.transport.requestJson("/api/shared-state", {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async listNamespaces() {
        return this.transport.requestJson("/api/shared-state/namespaces");
    }
    async list(namespace) {
        return this.transport.requestJson(`/api/shared-state?${new URLSearchParams({ namespace }).toString()}`);
    }
    async get(namespace, key) {
        return this.transport.requestJson(`/api/shared-state/detail?${new URLSearchParams({ namespace, key }).toString()}`);
    }
    async compareAndSet(payload) {
        return this.transport.requestJson("/api/shared-state/cas", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async delete(namespace, key) {
        await this.transport.requestJson(`/api/shared-state?${new URLSearchParams({ namespace, key }).toString()}`, {
            method: "DELETE"
        });
    }
    async purgeExpired(namespace) {
        const suffix = namespace ? `?${new URLSearchParams({ namespace }).toString()}` : "";
        return this.transport.requestJson(`/api/shared-state/purge-expired${suffix}`, {
            method: "POST"
        });
    }
}
