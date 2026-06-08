import { querySuffix } from "./query-suffix.js";
export class ScheduleApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list(scriptId, intent) {
        const suffix = querySuffix({ intent });
        if (scriptId) {
            return this.transport.requestJson(`/api/scripts/${scriptId}/schedules${suffix}`);
        }
        return this.transport.requestJson(`/api/schedules${suffix}`);
    }
    async get(scheduleId) {
        return this.transport.requestJson(`/api/schedules/${scheduleId}`);
    }
    async create(payload) {
        return this.transport.requestJson("/api/schedules", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async update(scheduleId, payload) {
        return this.transport.requestJson(`/api/schedules/${scheduleId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async enable(scheduleId) {
        return this.transport.requestJson(`/api/schedules/${scheduleId}/enable`, {
            method: "POST"
        });
    }
    async disable(scheduleId) {
        return this.transport.requestJson(`/api/schedules/${scheduleId}/disable`, {
            method: "POST"
        });
    }
    async delete(scheduleId) {
        await this.transport.requestJson(`/api/schedules/${scheduleId}`, {
            method: "DELETE"
        });
    }
}
