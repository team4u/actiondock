export class ExecutionApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async get(executionId) {
        return this.transport.requestJson(`/api/executions/${executionId}`);
    }
    async list(params) {
        const search = new URLSearchParams();
        if (params.scriptId) {
            search.set("scriptId", params.scriptId);
        }
        if (params.scheduleId) {
            search.set("scheduleId", params.scheduleId);
        }
        return this.transport.requestJson(`/api/executions?${search.toString()}`);
    }
    async delete(executionId) {
        await this.transport.requestJson(`/api/executions/${executionId}`, {
            method: "DELETE"
        });
    }
    async clear(scriptId) {
        const suffix = scriptId ? `?${new URLSearchParams({ scriptId }).toString()}` : "";
        await this.transport.requestJson(`/api/executions${suffix}`, {
            method: "DELETE"
        });
    }
}
