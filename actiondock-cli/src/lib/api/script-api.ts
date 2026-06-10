import type {
  ExecutionResponse,
  PublishedScriptRevision,
  ScriptDefinition,
  UpstreamStatus,
} from "../types.js";
import type { HttpTransport } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";

export interface ExecuteOptions {
  scriptId: string;
  input: Record<string, unknown>;
  mode: "SYNC" | "ASYNC";
  responseView: "RESULT" | "DEBUG";
}

function normalizeScriptDefinition(script: ScriptDefinition): ScriptDefinition {
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

function normalizePublishedRevision(scriptId: string, revision: PublishedScriptRevision): ScriptDefinition {
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
  private readonly transport: HttpTransport;

  constructor(transport: HttpTransport) {
    this.transport = transport;
  }

  async list(intent?: string): Promise<ScriptDefinition[]> {
    const suffix = querySuffix({ intent });
    return this.transport.requestJson<ScriptDefinition[]>(`/api/scripts${suffix}`).then((items) => items.map(normalizeScriptDefinition));
  }

  async get(scriptId: string, draft: boolean): Promise<ScriptDefinition> {
    if (draft) {
      return this.transport.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}`).then(normalizeScriptDefinition);
    }
    return this.transport.requestJson<PublishedScriptRevision>(`/api/scripts/${scriptId}/published`)
      .then((revision) => normalizePublishedRevision(scriptId, revision));
  }

  async create(definition: ScriptDefinition): Promise<ScriptDefinition> {
    return this.transport.requestJson<ScriptDefinition>("/api/scripts", {
      method: "POST",
      body: JSON.stringify(definition)
    }).then(normalizeScriptDefinition);
  }

  async delete(scriptId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/scripts/${scriptId}`, {
      method: "DELETE"
    });
  }

  async fork(sourceScriptId: string, payload: { id: string; name: string }): Promise<ScriptDefinition> {
    return this.transport.requestJson<ScriptDefinition>(`/api/scripts/${sourceScriptId}/fork`, {
      method: "POST",
      body: JSON.stringify(payload)
    }).then(normalizeScriptDefinition);
  }

  async patch(scriptId: string, patch: Record<string, unknown>): Promise<ScriptDefinition> {
    return this.transport.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }).then(normalizeScriptDefinition);
  }

  async validate(scriptId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/scripts/${scriptId}/validate`, {
      method: "POST"
    });
  }

  async publish(scriptId: string): Promise<ScriptDefinition> {
    return this.transport.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/publish`, {
      method: "POST"
    }).then(normalizeScriptDefinition);
  }

  async discardDraft(scriptId: string): Promise<ScriptDefinition> {
    return this.transport.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/discard-draft`, {
      method: "POST"
    }).then(normalizeScriptDefinition);
  }

  async getUpstreamStatus(scriptId: string): Promise<UpstreamStatus | null> {
    return this.transport.requestJson<UpstreamStatus | null>(`/api/scripts/${scriptId}/upstream`);
  }

  async pullUpstream(scriptId: string, force = false): Promise<ScriptDefinition> {
    return this.transport.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/upstream/pull?force=${force}`, {
      method: "POST"
    }).then(normalizeScriptDefinition);
  }

  async execute(options: ExecuteOptions, draft: boolean): Promise<ExecutionResponse> {
    return this.transport.requestJson<ExecutionResponse>(`/api/scripts/${options.scriptId}/execute`, {
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
