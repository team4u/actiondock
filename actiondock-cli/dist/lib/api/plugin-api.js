import { parseContentDispositionFilename } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";
export class PluginApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list(intent) {
        const suffix = querySuffix({ intent });
        return this.transport.requestJson(`/api/plugins${suffix}`);
    }
    async get(pluginId) {
        return this.transport.requestJson(`/api/plugins/${pluginId}`);
    }
    async listReferences() {
        return this.transport.requestJson("/api/plugins/references");
    }
    async getConfig(pluginId) {
        return this.transport.requestJson(`/api/plugins/${pluginId}/config`);
    }
    async listConfigs(pluginId) {
        return this.transport.requestJson(`/api/plugins/${pluginId}/configs`);
    }
    async getNamedConfig(pluginId, configName) {
        return this.transport.requestJson(`/api/plugins/${pluginId}/configs/${encodeURIComponent(configName)}`);
    }
    async saveConfig(pluginId, config, configName) {
        const pathname = configName
            ? `/api/plugins/${pluginId}/configs/${encodeURIComponent(configName)}`
            : `/api/plugins/${pluginId}/config`;
        return this.transport.requestJson(pathname, {
            method: "PUT",
            body: JSON.stringify({ config })
        });
    }
    async deleteConfig(pluginId, configName) {
        await this.transport.requestJson(`/api/plugins/${pluginId}/configs/${encodeURIComponent(configName)}`, {
            method: "DELETE"
        });
    }
    async invoke(pluginId, action, payload) {
        return this.transport.requestJson(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async install(jarPath) {
        return this.transport.uploadFile("/api/plugins/install", jarPath);
    }
    async upgrade(pluginId, jarPath) {
        return this.transport.uploadFile(`/api/plugins/${pluginId}/upgrade`, jarPath);
    }
    async start(pluginId) {
        return this.transport.requestJson(`/api/plugins/${pluginId}/start`, {
            method: "POST"
        });
    }
    async stop(pluginId) {
        return this.transport.requestJson(`/api/plugins/${pluginId}/stop`, {
            method: "POST"
        });
    }
    async uninstall(pluginId, force = false) {
        await this.transport.requestJson(`/api/plugins/${pluginId}?${new URLSearchParams({ force: String(force) }).toString()}`, {
            method: "DELETE"
        });
    }
    async download(pluginId) {
        const response = await this.transport.requestBinary(`/api/plugins/${pluginId}/download`);
        return {
            filename: parseContentDispositionFilename(response.headers["content-disposition"]) ?? `${pluginId}.jar`,
            content: response.body
        };
    }
}
