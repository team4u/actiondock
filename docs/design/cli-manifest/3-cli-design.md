# CLI 侧实现设计

## 1. 概述

CLI 侧通过一份 Manifest JSON 驱动命令生成，核心组件为：

1. **GeneratedCommand**：通用命令基类，消费 Manifest 中的 CommandDescriptor 完成 HTTP 调用。
2. **通用执行器 bindCliInputToHttpRequest**：将 CLI args/flags 转换为 HTTP 请求。
3. **输出渲染器**：根据 OutputDescriptor 将响应数据格式化为人类可读文本或 JSON。
4. **动态命令加载**：运行时从 Manifest 注册 oclif 命令。
5. **命令生成器脚本**：构建期从后端 Manifest 生成 TypeScript 命令存根文件。

## 2. GeneratedCommand 基类

### 2.1 类设计

```typescript
// src/lib/generated-command.ts

import { Args, Command, Flags } from "@oclif/core";
import type { CommandDescriptor, FlagDescriptor, ArgDescriptor, HttpBinding, OutputDescriptor } from "./manifest-types.js";

/**
 * 由 Manifest 驱动的通用命令基类。
 * 
 * 消费 CommandDescriptor 完成以下工作：
 * 1. 根据 descriptor.args/flags 声明 oclif args/flags
 * 2. 解析用户输入
 * 3. 执行前置条件
 * 4. 调用 bindCliInputToHttpRequest 将输入转为 HTTP 请求
 * 5. 通过 ActionDockClient 发送请求
 * 6. 根据 OutputDescriptor 渲染输出
 */
export abstract class GeneratedCommand extends Command {

    /** 子类必须提供命令描述符 */
    abstract get descriptor(): CommandDescriptor;

    /** 由 ManifestProvider 注入的 client 工厂 */
    protected getClient!: (flags: Record<string, unknown>) => ActionDockClient;

    // 动态生成的 oclif 声明
    static descriptor: CommandDescriptor;
    
    static get args(): Record<string, any> {
        return buildOclifArgs(this.descriptor.args);
    }

    static get flags(): Record<string, any> {
        return buildOclifFlags(this.descriptor.flags);
    }

    static get description(): string {
        return this.descriptor.description;
    }

    async run(): Promise<void> {
        const parsed = await this.parse(this.constructor as any);
        const { args, flags } = parsed;

        try {
            // 1. 执行前置条件
            const preconditionContext = await this.executePreconditions(args, flags);

            // 2. 构建 HTTP 请求
            const httpRequest = bindCliInputToHttpRequest(
                this.descriptor.http,
                args,
                flags,
                preconditionContext
            );

            // 3. 发送请求
            const client = this.getClient(flags);
            const response = await client.executeManifestRequest(httpRequest);

            // 4. 渲染输出
            await this.renderOutput(response, flags);
        } catch (error) {
            this.handleError(error, flags.json);
        }
    }

    private async executePreconditions(
        args: Record<string, unknown>,
        flags: Record<string, unknown>
    ): Promise<PreconditionContext> {
        const context: PreconditionContext = {};
        const client = this.getClient(flags);

        for (const precondition of this.descriptor.preconditions ?? []) {
            switch (precondition.kind) {
                case "fetch-schema": {
                    const scriptId = resolvePreconditionRef(precondition.params.scriptIdArg, args, flags);
                    const useDraft = resolvePreconditionRef(precondition.params.useDraft, args, flags) ?? false;
                    const script = await client.getScript(scriptId, useDraft);
                    const schema = useDraft ? script.inputSchema : script.published?.inputSchema ?? script.inputSchema;
                    const fields = extractSchemaFields(schema);
                    context.schemaFields = fields;

                    // 收集动态 flags 并合并
                    const dynamicFlags = collectDynamicFlags(this.argv, {
                        positionals: Object.values(args).filter(Boolean).map(String)
                    });
                    const baseInput = parseInputObject(
                        flags["input-json"] as string | undefined,
                        flags["input-file"] as string | undefined
                    );
                    const { input: dynamicInput } = buildInputFromSchema(baseInput, dynamicFlags, fields);
                    context.dynamicInput = dynamicInput;
                    break;
                }
                case "intent-fallback": {
                    context.useIntentFallback = true;
                    break;
                }
                case "resolve-script": {
                    const scriptId = resolvePreconditionRef(precondition.params.scriptIdFlag, args, flags) as string;
                    const script = await client.getScript(scriptId);
                    context.resolvedScript = script;
                    break;
                }
            }
        }
        return context;
    }

    private async renderOutput(data: unknown, flags: Record<string, unknown>): Promise<void> {
        if (flags.json || !this.descriptor.output) {
            this.printJson(data);
            return;
        }

        const output = this.descriptor.output;
        switch (output.kind) {
            case "list":
                this.log(renderListOutput(data, output));
                break;
            case "detail":
                this.log(renderDetailOutput(data, output));
                break;
            case "void":
                this.log(output.successMessage ?? "操作成功。");
                break;
            case "raw":
            default:
                this.printJson(data);
                break;
        }
    }
}
```

### 2.2 oclif 声明构建器

```typescript
// src/lib/manifest-oclif.ts

import { Args, Flags } from "@oclif/core";
import type { ArgDescriptor, FlagDescriptor } from "./manifest-types.js";

export function buildOclifArgs(descriptors: ArgDescriptor[] | undefined): Record<string, any> {
    if (!descriptors || descriptors.length === 0) return {};
    const result: Record<string, any> = {};
    for (const desc of descriptors) {
        result[desc.name] = Args.string({
            required: desc.required,
            description: desc.description
        });
    }
    return result;
}

export function buildOclifFlags(descriptors: FlagDescriptor[] | undefined): Record<string, any> {
    const result: Record<string, any> = {
        ...BaseCommand.baseFlags,
        ...serverTokenFlags,
        help: Flags.help({ char: "h" })
    };

    if (!descriptors) return result;

    for (const desc of descriptors) {
        result[desc.name] = buildSingleFlag(desc);
    }
    return result;
}

function buildSingleFlag(desc: FlagDescriptor): any {
    const options: Record<string, any> = {
        description: desc.description,
        required: desc.required
    };

    if (desc.char) options.char = desc.char;
    if (desc.default !== undefined) options.default = desc.default;
    if (desc.multiple) options.multiple = true;

    switch (desc.type) {
        case "boolean":
            return Flags.boolean(options);
        case "number":
            return Flags.number(options);
        case "integer":
            return Flags.integer(options);
        case "enum":
            return Flags.string({ ...options, options: desc.options });
        case "string":
        default:
            return Flags.string(options);
    }
}
```

## 3. 通用执行器 bindCliInputToHttpRequest

### 3.1 函数签名

```typescript
// src/lib/manifest-executor.ts

interface ManifestHttpRequest {
    method: string;
    path: string;
    queryParams: Record<string, string | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
}

interface PreconditionContext {
    schemaFields?: SchemaFieldDescriptor[];
    dynamicInput?: Record<string, unknown>;
    resolvedScript?: ScriptDefinition;
    useIntentFallback?: boolean;
}

export function bindCliInputToHttpRequest(
    httpBinding: HttpBinding,
    args: Record<string, unknown>,
    flags: Record<string, unknown>,
    preconditionContext: PreconditionContext
): ManifestHttpRequest { ... }
```

### 3.2 路径参数解析

```typescript
function resolvePath(
    pathTemplate: string,
    pathParams: string[],
    args: Record<string, unknown>,
    flags: Record<string, unknown>
): string {
    let result = pathTemplate;
    for (const paramName of pathParams) {
        const value = args[paramName] ?? flags[paramName];
        if (value === undefined) {
            throw new ActionDockCliError(`路径参数 ${paramName} 缺失`, 2);
        }
        // 支持两种模板格式: {id} 和 {scriptId}
        result = result.replace(/\{[^}]+\}/, String(value));
    }
    return result;
}
```

### 3.3 查询参数解析

```typescript
function resolveQueryParams(
    queryBindings: QueryParamBinding[],
    flags: Record<string, unknown>,
    args: Record<string, unknown>
): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {};

    for (const binding of queryBindings) {
        let value: unknown;

        switch (binding.source ?? "flag") {
            case "flag": {
                const sourceName = binding.sourceName ?? binding.name;
                value = flags[sourceName];
                break;
            }
            case "arg": {
                const sourceName = binding.sourceName ?? binding.name;
                value = args[sourceName];
                break;
            }
            case "literal": {
                value = binding.defaultValue;
                break;
            }
        }

        // 应用变换
        value = applyTransform(value, binding);

        // 省略默认值
        if (binding.omitWhenDefault !== false && value === binding.defaultValue) {
            continue;
        }

        if (value !== undefined && value !== null) {
            result[binding.name] = String(value);
        }
    }

    return result;
}
```

### 3.4 Body 构建

```typescript
function resolveBody(
    bodyTemplate: Record<string, unknown> | undefined,
    args: Record<string, unknown>,
    flags: Record<string, unknown>,
    preconditionContext: PreconditionContext
): unknown {
    if (!bodyTemplate) return undefined;

    const result: Record<string, unknown> = {};

    for (const [key, template] of Object.entries(bodyTemplate)) {
        if (typeof template !== "string") {
            result[key] = template;
            continue;
        }

        // 特殊占位符: {dynamicInput} 来自 precondition schema 解析
        if (template === "{dynamicInput}") {
            result[key] = preconditionContext.dynamicInput ?? {};
            continue;
        }

        // 模板变量替换: {args.xxx}, {flags.yyy}
        const resolved = resolveTemplateValue(template, args, flags);
        result[key] = resolved;
    }

    return result;
}

function resolveTemplateValue(
    template: string,
    args: Record<string, unknown>,
    flags: Record<string, unknown>
): unknown {
    const match = template.match(/^\{(args|flags)\.(.+)\}$/);
    if (!match) return template;

    const [, source, name] = match;
    const bag = source === "args" ? args : flags;

    // 支持 kebab-case flag 名到 camelCase 的查找
    const camelName = kebabToCamel(name);
    return bag[name] ?? bag[camelName];
}

function kebabToCamel(str: string): string {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
```

### 3.5 Flag 值变换

```typescript
function applyFlagTransform(
    value: unknown,
    binding: FlagBinding | undefined
): unknown {
    if (!binding || binding.transform === "none" || value === undefined) {
        return value;
    }

    switch (binding.transform) {
        case "uppercase":
            return typeof value === "string" ? value.toUpperCase() : value;
        case "lowercase":
            return typeof value === "string" ? value.toLowerCase() : value;
        case "boolean-to-string":
            return String(Boolean(value));
        default:
            return value;
    }
}
```

## 4. 输出渲染器

### 4.1 渲染器注册表

```typescript
// src/lib/manifest-renderer.ts

import type { OutputDescriptor, ColumnDescriptor, FieldDisplay } from "./manifest-types.js";

/** 已注册的实体类型自定义渲染器 */
const entityRenderers = new Map<string, EntityRenderer>();

export interface EntityRenderer {
    renderList(items: unknown[]): string;
    renderDetail(item: unknown): string;
}

export function registerEntityRenderer(entityType: string, renderer: EntityRenderer): void {
    entityRenderers.set(entityType, renderer);
}

/** 如果有自定义注册渲染器则使用，否则按 OutputDescriptor 声明式渲染 */
export function renderListOutput(data: unknown, output: OutputDescriptor): string {
    const items = Array.isArray(data) ? data : [data];

    // 优先使用注册的自定义渲染器
    const renderer = output.entityType ? entityRenderers.get(output.entityType) : undefined;
    if (renderer) {
        return renderer.renderList(items);
    }

    // 回退到声明式渲染
    if (!output.columns) return JSON.stringify(items, null, 2);
    return renderTable(items, output.columns);
}

export function renderDetailOutput(data: unknown, output: OutputDescriptor): string {
    const renderer = output.entityType ? entityRenderers.get(output.entityType) : undefined;
    if (renderer) {
        return renderer.renderDetail(data);
    }

    if (!output.fields) return JSON.stringify(data, null, 2);
    return renderFields(data, output.fields);
}
```

### 4.2 声明式表格渲染

```typescript
function renderTable(items: unknown[], columns: ColumnDescriptor[]): string {
    if (items.length === 0) return "没有可用数据。";

    return items.map(item => {
        return columns.map(col => {
            const value = getNestedValue(item, col.field);
            const display = formatValue(value, col.transform, col.whenNull);
            return display;
        }).join("  ");
    }).join("\n");
}

function renderFields(data: unknown, fields: FieldDisplay[]): string {
    const record = data as Record<string, unknown>;
    return fields.map(field => {
        const value = getNestedValue(record, field.field);
        const display = formatValue(value, field.transform, field.whenNull);
        return `${field.label}: ${display}`;
    }).join("\n");
}

function formatValue(
    value: unknown,
    transform: string = "none",
    whenNull: string = ""
): string {
    if (value === null || value === undefined) return whenNull || "(空)";

    switch (transform) {
        case "boolean-tag":
            return value ? "yes" : "no";
        case "datetime":
            return String(value);
        case "json":
            return JSON.stringify(value, null, 2);
        case "code-block":
            return String(value);
        case "mask-secret":
            return "****";
        case "truncate":
            return String(value).substring(0, 50);
        default:
            return String(value);
    }
}
```

### 4.3 自定义渲染器注册

保留现有 `render.ts` 中的函数，在 CLI 初始化时注册为自定义渲染器：

```typescript
// src/lib/render-registry.ts (新增)

import { registerEntityRenderer } from "./manifest-renderer.js";

export function registerAllEntityRenderers(): void {
    // 现有渲染函数注册为自定义渲染器，保持 100% 向后兼容
    registerEntityRenderer("ScriptDefinition", {
        renderList: (items) => renderScriptList(items as ScriptDefinition[]),
        renderDetail: (item) => renderScriptDetail(item as ScriptDefinition)
    });

    registerEntityRenderer("ExecutionResponse", {
        renderList: () => "",
        renderDetail: (item) => renderExecution(item as ExecutionResponse)
    });

    registerEntityRenderer("WebhookDefinition", {
        renderList: (items) => renderWebhookList(items as WebhookDefinition[]),
        renderDetail: (item) => renderWebhookDetail(item as WebhookDefinition)
    });

    // ... 其他实体类型
}
```

## 5. 动态命令加载机制

### 5.1 ManifestProvider

```typescript
// src/lib/manifest-provider.ts

import fs from "node:fs";
import path from "node:path";
import type { CliManifest, CommandDescriptor } from "./manifest-types.js";

const CACHE_FILE_NAME = "manifest-cache.json";

export class ManifestProvider {

    private cachedManifest: CliManifest | null = null;
    private cachedChecksum: string | null = null;

    /**
     * 获取 Manifest，优先使用本地缓存。
     * 
     * 策略：
     * 1. 加载内嵌 default-manifest.json
     * 2. 如果有网络连接，调用 /api/cli/manifest/checksum
     * 3. checksum 一致则使用缓存，否则拉取完整 Manifest
     * 4. 拉取后写入磁盘缓存
     */
    async getManifest(client: ActionDockClient): Promise<CliManifest> {
        // 使用内存缓存
        if (this.cachedManifest) {
            return this.cachedManifest;
        }

        // 尝试加载磁盘缓存
        const diskCache = this.loadDiskCache();
        if (diskCache) {
            this.cachedManifest = diskCache;
        }

        // 尝试从后端拉取最新
        try {
            const serverChecksum = await client.getManifestChecksum();
            const localChecksum = this.cachedManifest?.buildTimestamp ?? "";

            if (serverChecksum.buildTimestamp !== localChecksum) {
                const manifest = await client.getManifest();
                this.cachedManifest = manifest;
                this.saveDiskCache(manifest);
            }
        } catch {
            // 网络失败时使用本地缓存或内嵌版本
        }

        if (!this.cachedManifest) {
            // 加载内嵌默认 Manifest
            this.cachedManifest = this.loadEmbeddedManifest();
        }

        return this.cachedManifest;
    }

    private loadEmbeddedManifest(): CliManifest {
        const embeddedPath = path.join(__dirname, "..", "default-manifest.json");
        return JSON.parse(fs.readFileSync(embeddedPath, "utf8"));
    }

    private loadDiskCache(): CliManifest | null {
        const cachePath = this.getCachePath();
        if (!fs.existsSync(cachePath)) return null;
        try {
            return JSON.parse(fs.readFileSync(cachePath, "utf8"));
        } catch {
            return null;
        }
    }

    private saveDiskCache(manifest: CliManifest): void {
        const cachePath = this.getCachePath();
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify(manifest, null, 2), "utf8");
    }

    private getCachePath(): string {
        const xdgCache = process.env.XDG_CACHE_HOME ?? path.join(require("os").homedir(), ".cache");
        return path.join(xdgCache, "actiondock", CACHE_FILE_NAME);
    }
}
```

### 5.2 运行时命令注册

oclif 支持通过 `plugin` 机制动态注册命令。Manifest 驱动的命令通过自定义 oclif plugin 注入：

```typescript
// src/lib/manifest-plugin.ts

import { Command, Plugin } from "@oclif/core";
import type { CliManifest, CommandDescriptor } from "./manifest-types.js";
import { ManifestProvider } from "./manifest-provider.js";

export class ManifestPlugin extends Plugin {

    private commands: Command.Class[] = [];

    async load(manifest: CliManifest): Promise<void> {
        for (const descriptor of manifest.commands) {
            const CommandClass = this.createCommandClass(descriptor);
            this.commands.push(CommandClass);
        }
    }

    private createCommandClass(descriptor: CommandDescriptor): Command.Class {
        const plugin = this;

        // 动态创建 oclif Command 子类
        class DynamicGeneratedCommand extends GeneratedCommand {
            static id = `${descriptor.topic} ${descriptor.action}`;
            static summary = descriptor.description;
            static hidden = false;
            static aliases = descriptor.aliases ?? [];

            get descriptor(): CommandDescriptor {
                return descriptor;
            }
        }

        // 将 descriptor 附加到 static 属性供 buildOclifArgs/Flags 使用
        (DynamicGeneratedCommand as any).descriptor = descriptor;
        (DynamicGeneratedCommand as any).strict = descriptor.preconditions?.some(
            p => p.kind === "fetch-schema"
        ) ?? false;

        return DynamicGeneratedCommand as Command.Class;
    }

    get commands(): Command.Class[] {
        return this.commands;
    }
}
```

### 5.3 初始化时机

```typescript
// src/bin/run.js (修改)

import { ManifestPlugin } from "../lib/manifest-plugin.js";
import { ManifestProvider } from "../manifest-provider.js";

// 在 oclif run 之前加载 Manifest
async function bootstrap() {
    const provider = new ManifestProvider();
    const client = new ActionDockClient({ serverUrl: resolveServerUrl({}) });
    
    let manifest: CliManifest;
    try {
        manifest = await provider.getManifest(client);
    } catch {
        // 完全离线时使用内嵌版本
        manifest = provider.getEmbeddedManifest();
    }

    return new ManifestPlugin().load(manifest);
}
```

## 6. 命令生成器脚本

### 6.1 设计目标

构建期脚本从后端拉取 Manifest，生成 TypeScript 命令存根文件，作为 `dist/commands/` 下的实际文件。这提供了：

- IDE 类型提示和自动补全
- 构建时验证 Manifest 的正确性
- 回退到静态命令（无法连接后端时）

### 6.2 脚本设计

```typescript
// scripts/generate-commands.ts

/**
 * 从后端 Manifest 生成 TypeScript 命令文件。
 * 
 * 用法: npx tsx scripts/generate-commands.ts [--server URL] [--output DIR]
 * 
 * 生成策略:
 * - 对于每个 CommandDescriptor，生成一个最小化的 .ts 文件
 * - 文件内容为: import + export default class extends GeneratedCommand
 * - 手写命令（存在同名文件时）不会被覆盖
 */
```

### 6.3 生成文件模板

对于描述符 `{ id: "script-list", topic: "script", action: "list", ... }`:

生成文件 `src/commands/script/list.generated.ts`（注意 `.generated.ts` 后缀，不与现有手写文件冲突）：

```typescript
// Auto-generated from CLI Manifest. DO NOT EDIT.
// Manual override: create list.ts in the same directory.

import { GeneratedCommand } from "../../lib/generated-command.js";
import manifest from "../../default-manifest.json" assert { type: "json" };

const descriptor = manifest.commands.find(c => c.id === "script-list")!;

export default class ScriptListGenerated extends GeneratedCommand {
    static id = "script list";
    static description = descriptor.description;
    static descriptor = descriptor;
    static strict = false;

    get descriptor() { return descriptor; }
}
```

### 6.4 构建集成

在 `package.json` 中添加：

```json
{
    "scripts": {
        "generate-commands": "npx tsx scripts/generate-commands.ts",
        "build": "npm run clean:dist && npm run generate-commands && tsc -p tsconfig.json"
    }
}
```

oclif 配置中指定命令搜索路径包含 `.generated.ts`：

```json
{
    "oclif": {
        "commands": "./dist/commands",
        "additionalCommands": "./dist/generated-commands"
    }
}
```

## 7. ActionDockClient 扩展

### 7.1 新增 Manifest 相关方法

```typescript
// 在 client.ts 中新增

async getManifestChecksum(): Promise<{ checksum: string; buildTimestamp: string; commandCount: number }> {
    const envelope = await this.requestJson<ApiEnvelope<{
        checksum: string; buildTimestamp: string; commandCount: number;
    }>>({ method: "GET", path: "/api/cli/manifest/checksum" });
    return envelope.data;
}

async getManifest(): Promise<CliManifest> {
    const envelope = await this.requestJson<ApiEnvelope<CliManifest>>({
        method: "GET",
        path: "/api/cli/manifest"
    });
    return envelope.data;
}

/**
 * 通用 Manifest 驱动的 HTTP 请求执行。
 * 替代现有的每个 API 方法，由 GeneratedCommand 调用。
 */
async executeManifestRequest(request: ManifestHttpRequest): Promise<unknown> {
    const response = await this.requestJson<ApiEnvelope<unknown>>({
        method: request.method,
        path: request.path,
        queryParams: request.queryParams,
        body: request.body
    });

    // 解包 ApiResponse 信封
    return response.data;
}
```

### 7.2 intent-fallback 支持

```typescript
/**
 * 带有 intent fallback 的列表查询。
 * 由 Manifest precondition "intent-fallback" 驱动。
 */
async executeManifestListRequest(
    request: ManifestHttpRequest,
    intentFlag?: string
): Promise<unknown[]> {
    if (intentFlag) {
        request.queryParams = { ...request.queryParams, intent: intentFlag };
    }
    const items = await this.executeManifestRequest(request) as unknown[];

    // fallback: intent 无匹配时重新查询
    if (intentFlag && items.length === 0) {
        const fallbackRequest = { ...request };
        delete fallbackRequest.queryParams.intent;
        return this.executeManifestRequest(fallbackRequest) as Promise<unknown[]>;
    }

    return items;
}
```

## 8. 需要修改/新增的文件清单

### 8.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/lib/manifest-types.ts` | Manifest JSON 的 TypeScript 类型定义（对应 cli-manifest-spec.md 中的 JSON Schema） |
| `src/lib/generated-command.ts` | GeneratedCommand 基类 |
| `src/lib/manifest-oclif.ts` | oclif args/flags 构建器 |
| `src/lib/manifest-executor.ts` | bindCliInputToHttpRequest 通用执行器 |
| `src/lib/manifest-renderer.ts` | 声明式输出渲染器 + 注册表 |
| `src/lib/manifest-provider.ts` | Manifest 获取/缓存/加载 |
| `src/lib/manifest-plugin.ts` | oclif 动态命令注册插件 |
| `src/lib/render-registry.ts` | 现有渲染函数注册为自定义渲染器 |
| `src/default-manifest.json` | 内嵌默认 Manifest（构建期生成） |
| `scripts/generate-commands.ts` | 命令生成器脚本 |
| `scripts/fetch-manifest.ts` | 从后端拉取 Manifest 的工具脚本 |

### 8.2 需要修改的文件

| 文件路径 | 变更内容 |
|---------|---------|
| `src/lib/client.ts` | 新增 `getManifest()`, `getManifestChecksum()`, `executeManifestRequest()` 方法 |
| `src/lib/render.ts` | 导出各个 render 函数供 render-registry.ts 注册 |
| `src/lib/command.ts` | BaseCommand 保持不变，作为手写命令的基类 |
| `src/lib/command-helpers.ts` | 保持不变，手写命令继续使用 |
| `package.json` | 新增 `generate-commands` 脚本；oclif 配置新增 `additionalCommands` |
| `src/bin/run.js` | 可选：集成 ManifestPlugin 动态加载 |

### 8.3 不需要修改的文件

以下文件在迁移完成后可以逐步删除，但在并存期间保持不变：

- `src/commands/script/list.ts` 及其他手写命令（被 `.generated.ts` 替代前保持原样）
- `src/lib/input.ts` （GeneratedCommand 内部继续使用）
- `src/lib/schema.ts` （GeneratedCommand 内部继续使用）
