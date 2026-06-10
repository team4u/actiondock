import { querySuffix } from "./query-suffix.js";
function normalizeScriptDefinition(script) {
    const published = script.published ?? null;
    const publishedFlag = Boolean(script.publication?.published ?? published);
    const dirty = Boolean(script.publication?.dirty);
    return {
        ...script,
        published,
        publication: {
            published: publishedFlag,
            dirty,
            publishedVersion: script.publication?.publishedVersion ?? published?.version,
            publishedAt: script.publication?.publishedAt ?? published?.publishedAt
        }
    };
}
function normalizePublishedRevision(scriptId, revision) {
    return normalizeScriptDefinition({
        id: revision.scriptId || scriptId,
        name: revision.name,
        type: revision.type,
        packaging: revision.packaging,
        source: revision.source,
        pythonRequirements: revision.pythonRequirements,
        inputSchema: revision.inputSchema,
        outputSchema: revision.outputSchema,
        version: revision.version,
        owner: revision.owner,
        description: revision.description,
        tags: revision.tags,
        published: revision,
        publication: {
            published: true,
            dirty: false,
            publishedVersion: revision.version,
            publishedAt: revision.publishedAt
        }
    });
}
export class ScriptApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list(intent) {
        const suffix = querySuffix({ intent });
        return this.transport.requestJson(`/api/scripts${suffix}`).then((items) => items.map(normalizeScriptDefinition));
    }
    async get(scriptId, draft) {
        if (draft) {
            return this.transport.requestJson(`/api/scripts/${scriptId}`).then(normalizeScriptDefinition);
        }
        return this.transport.requestJson(`/api/scripts/${scriptId}/published`)
            .then((revision) => normalizePublishedRevision(scriptId, revision));
    }
    async create(definition) {
        return this.transport.requestJson("/api/scripts", {
            method: "POST",
            body: JSON.stringify(definition)
        }).then(normalizeScriptDefinition);
    }
    async delete(scriptId) {
        await this.transport.requestJson(`/api/scripts/${scriptId}`, {
            method: "DELETE"
        });
    }
    async fork(sourceScriptId, payload) {
        return this.transport.requestJson(`/api/scripts/${sourceScriptId}/fork`, {
            method: "POST",
            body: JSON.stringify(payload)
        }).then(normalizeScriptDefinition);
    }
    async patch(scriptId, patch) {
        return this.transport.requestJson(`/api/scripts/${scriptId}`, {
            method: "PATCH",
            body: JSON.stringify(patch)
        }).then(normalizeScriptDefinition);
    }
    async validate(scriptId) {
        await this.transport.requestJson(`/api/scripts/${scriptId}/validate`, {
            method: "POST"
        });
    }
    async publish(scriptId) {
        return this.transport.requestJson(`/api/scripts/${scriptId}/publish`, {
            method: "POST"
        }).then(normalizeScriptDefinition);
    }
    async discardDraft(scriptId) {
        return this.transport.requestJson(`/api/scripts/${scriptId}/discard-draft`, {
            method: "POST"
        }).then(normalizeScriptDefinition);
    }
    async getUpstreamStatus(scriptId) {
        return this.transport.requestJson(`/api/scripts/${scriptId}/upstream`);
    }
    async pullUpstream(scriptId, force = false) {
        return this.transport.requestJson(`/api/scripts/${scriptId}/upstream/pull?force=${force}`, {
            method: "POST"
        }).then(normalizeScriptDefinition);
    }
    async execute(options, draft) {
        return this.transport.requestJson(`/api/scripts/${options.scriptId}/execute`, {
            method: "POST",
            body: JSON.stringify({
                input: options.input,
                draft,
                mode: options.mode,
                responseView: options.responseView
            })
        });
    }
}
