import { HttpTransport } from "./api/http-transport.js";
import { HealthApi } from "./api/health-api.js";
import { ScriptApi } from "./api/script-api.js";
import { ExecutionApi } from "./api/execution-api.js";
import { ScheduleApi } from "./api/schedule-api.js";
import { PresetApi } from "./api/preset-api.js";
import { WebhookApi } from "./api/webhook-api.js";
import { PluginApi } from "./api/plugin-api.js";
import { RepositoryApi } from "./api/repository-api.js";
import { ConfigValueApi } from "./api/config-value-api.js";
import { AccessTokenApi } from "./api/access-token-api.js";
import { SharedStateApi } from "./api/shared-state-api.js";
import { PlaybookApi } from "./api/playbook-api.js";
export class ActionDockClient {
    health;
    scripts;
    executions;
    schedules;
    presets;
    webhooks;
    plugins;
    repositories;
    configValues;
    accessTokens;
    sharedState;
    playbooks;
    constructor(options) {
        const transport = new HttpTransport(options);
        this.health = new HealthApi(transport);
        this.scripts = new ScriptApi(transport);
        this.executions = new ExecutionApi(transport);
        this.schedules = new ScheduleApi(transport);
        this.presets = new PresetApi(transport);
        this.webhooks = new WebhookApi(transport);
        this.plugins = new PluginApi(transport);
        this.repositories = new RepositoryApi(transport);
        this.configValues = new ConfigValueApi(transport);
        this.accessTokens = new AccessTokenApi(transport);
        this.sharedState = new SharedStateApi(transport);
        this.playbooks = new PlaybookApi(transport);
    }
}
