export class AccessTokenApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list() {
        return this.transport.requestJson("/api/access-tokens");
    }
    async create(name) {
        return this.transport.requestJson("/api/access-tokens", {
            method: "POST",
            body: JSON.stringify({ name })
        });
    }
    async rename(tokenId, name) {
        return this.transport.requestJson(`/api/access-tokens/${tokenId}`, {
            method: "PUT",
            body: JSON.stringify({ name })
        });
    }
    async enable(tokenId) {
        return this.transport.requestJson(`/api/access-tokens/${tokenId}/enable`, {
            method: "POST"
        });
    }
    async disable(tokenId) {
        return this.transport.requestJson(`/api/access-tokens/${tokenId}/disable`, {
            method: "POST"
        });
    }
    async delete(tokenId) {
        await this.transport.requestJson(`/api/access-tokens/${tokenId}`, {
            method: "DELETE"
        });
    }
}
