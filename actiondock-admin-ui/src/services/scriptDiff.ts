import { diffLines } from "diff";
import { prettyJson } from "./utils";
import type {
  PluginDependency,
  RepositoryScriptDetail,
  ScriptDefinition,
  ScriptDependency,
  ScriptPackaging,
  ScriptType
} from "../shared/types";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type ScriptDiffContext = "publish" | "import";
export type ScriptDiffComparisonMode = "INITIAL" | "COMPARE";
export type DiffTabKey = "source" | "inputSchema" | "outputSchema" | "metadata" | "dependencies";

export interface ScriptDiffTarget {
  name?: string;
  type?: ScriptType;
  packaging?: ScriptPackaging;
  source?: string;
  pythonRequirements?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  description?: string;
  owner?: string;
  tags?: string[];
  scriptDependencies?: ScriptDependency[];
  pluginDependencies?: PluginDependency[];
  aiDependencies?: string[];
  rawInputSchemaText?: string;
  rawOutputSchemaText?: string;
}

export interface ScriptDiffResult {
  comparisonMode: ScriptDiffComparisonMode;
  context: ScriptDiffContext;
  hasChanges: boolean;
  riskLevel: RiskLevel;
  highlights: string[];
  warnings: string[];
  tabs: DiffTabKey[];
  source: SourceDiffSummary;
  inputSchema: SchemaDiffSummary;
  outputSchema: SchemaDiffSummary;
  metadata: MetadataDiffSummary;
  dependencies: DependencyDiffSummary;
}

export interface SourceDiffSummary {
  available: boolean;
  changed: boolean;
  risk: RiskLevel;
  addedLines: number;
  removedLines: number;
  original: string;
  modified: string;
  matchedHighRiskKeywords: string[];
}

export interface SchemaDiffSummary {
  available: boolean;
  changed: boolean;
  risk: RiskLevel;
  addedFields: SchemaFieldChange[];
  removedFields: SchemaFieldChange[];
  modifiedFields: SchemaFieldModification[];
  fallbackToRaw: boolean;
  rawBeforeText: string;
  rawAfterText: string;
  warnings: string[];
}

export interface SchemaFieldChange {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  risk: RiskLevel;
}

export interface SchemaFieldModification {
  name: string;
  changes: SchemaPropertyChange[];
}

export interface SchemaPropertyChange {
  property: "type" | "required" | "default" | "enum" | "description" | "widget" | "rows";
  before: unknown;
  after: unknown;
  risk: RiskLevel;
}

export interface MetadataDiffSummary {
  available: boolean;
  changed: boolean;
  risk: RiskLevel;
  changes: Array<{
    field: string;
    label: string;
    before: unknown;
    after: unknown;
    risk: RiskLevel;
  }>;
}

export interface DependencyDiffSummary {
  available: boolean;
  changed: boolean;
  risk: RiskLevel;
  added: DependencyChange[];
  removed: DependencyChange[];
  modified: DependencyModification[];
  unchanged: DependencyChange[];
}

export interface DependencyChange {
  dependencyType: "PLUGIN" | "SCRIPT";
  dependencyId: string;
  target?: string;
  action?: string;
  versionRange?: string;
  requiredActions: string[];
  risk: RiskLevel;
}

export interface DependencyModification {
  dependencyType: "PLUGIN" | "SCRIPT";
  dependencyId: string;
  changes: Array<{
    field: "versionRange" | "requiredActions" | "target";
    before: unknown;
    after: unknown;
    risk: RiskLevel;
  }>;
}

interface BuildScriptDiffOptions {
  context: ScriptDiffContext;
}

interface NormalizedSchemaField {
  name: string;
  type?: string;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  enumValues?: string[];
  widget?: string;
  rows?: number;
  unsupportedReason?: string;
}

const HIGH_RISK_SOURCE_KEYWORDS = ["delete", "drop", "truncate", "production"];
const RISK_WEIGHTS: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: string | undefined): string {
  return value ?? "";
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalTextValue(value: unknown): string | undefined {
  return normalizeString(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function maxRisk(...levels: Array<RiskLevel | undefined>): RiskLevel {
  return levels.reduce<RiskLevel>(
    (highest, level) => (level && RISK_WEIGHTS[level] > RISK_WEIGHTS[highest] ? level : highest),
    "LOW"
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countLines(text: string): number {
  if (!text.trim()) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function extractMatchedKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  return HIGH_RISK_SOURCE_KEYWORDS.filter((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(normalized)
  );
}

function toSchemaFields(schema: Record<string, unknown> | undefined): {
  fields: Map<string, NormalizedSchemaField>;
  warnings: string[];
  fallbackToRaw: boolean;
} {
  const fields = new Map<string, NormalizedSchemaField>();
  const warnings: string[] = [];

  if (!schema || Object.keys(schema).length === 0) {
    return { fields, warnings, fallbackToRaw: false };
  }

  if (!isRecord(schema.properties)) {
    warnings.push("Schema 缺少可解析的 properties，已回退为原始 JSON 对比。");
    return { fields, warnings, fallbackToRaw: true };
  }

  const requiredSet = new Set(normalizeStringArray(schema.required));

  Object.entries(schema.properties).forEach(([name, value]) => {
    if (!isRecord(value)) {
      warnings.push(`字段 ${name} 不是对象定义，已回退为原始 JSON 对比。`);
      return;
    }

    const meta = value;
    const rawType = normalizeString(meta.type);
    const enumValues = normalizeStringArray(meta.enum);
    const ui = isRecord(meta["x-ui"]) ? meta["x-ui"] : undefined;
    const unsupportedReason =
      "properties" in meta || "items" in meta
        ? "包含嵌套结构"
        : rawType && !["string", "number", "integer", "boolean", "object", "array"].includes(rawType)
          ? `包含不支持类型 ${rawType}`
          : Array.isArray(meta.enum) && enumValues.length !== meta.enum.length
            ? "包含非字符串 enum"
            : undefined;

    fields.set(name, {
      name,
      type: enumValues.length > 0 ? "enum" : rawType,
      required: requiredSet.has(name),
      description: normalizeString(meta.description),
      defaultValue: "default" in meta ? meta.default : undefined,
      enumValues: enumValues.length > 0 ? enumValues : undefined,
      widget: normalizeString(ui?.widget),
      rows: typeof ui?.rows === "number" ? ui.rows : undefined,
      unsupportedReason
    });
  });

  const unsupportedReasons = [...fields.values()]
    .filter((field) => field.unsupportedReason)
    .map((field) => `${field.name}: ${field.unsupportedReason}`);

  if (unsupportedReasons.length > 0) {
    warnings.push(`Schema 包含复杂字段，结构化 Diff 仅覆盖顶层字段：${unsupportedReasons.join("；")}`);
  }

  return {
    fields,
    warnings,
    fallbackToRaw: warnings.length > 0
  };
}

function buildSchemaPropertyChanges(
  beforeField: NormalizedSchemaField,
  afterField: NormalizedSchemaField,
  schemaKind: "input" | "output"
): SchemaPropertyChange[] {
  const changes: SchemaPropertyChange[] = [];

  if (!sameValue(beforeField.type, afterField.type)) {
    changes.push({
      property: "type",
      before: beforeField.type,
      after: afterField.type,
      risk: "HIGH"
    });
  }

  if (!sameValue(beforeField.required, afterField.required)) {
    changes.push({
      property: "required",
      before: beforeField.required,
      after: afterField.required,
      risk:
        schemaKind === "input"
          ? !beforeField.required && afterField.required
            ? "HIGH"
            : "LOW"
          : "LOW"
    });
  }

  if (!sameValue(beforeField.defaultValue, afterField.defaultValue)) {
    changes.push({
      property: "default",
      before: beforeField.defaultValue,
      after: afterField.defaultValue,
      risk: "MEDIUM"
    });
  }

  if (!sameValue(beforeField.enumValues ?? [], afterField.enumValues ?? [])) {
    const removedValues = (beforeField.enumValues ?? []).filter(
      (value) => !(afterField.enumValues ?? []).includes(value)
    );
    changes.push({
      property: "enum",
      before: beforeField.enumValues ?? [],
      after: afterField.enumValues ?? [],
      risk: removedValues.length > 0 ? "HIGH" : "MEDIUM"
    });
  }

  if (!sameValue(beforeField.description, afterField.description)) {
    changes.push({
      property: "description",
      before: beforeField.description,
      after: afterField.description,
      risk: "LOW"
    });
  }

  if (!sameValue(beforeField.widget, afterField.widget)) {
    changes.push({
      property: "widget",
      before: beforeField.widget,
      after: afterField.widget,
      risk: "LOW"
    });
  }

  if (!sameValue(beforeField.rows, afterField.rows)) {
    changes.push({
      property: "rows",
      before: beforeField.rows,
      after: afterField.rows,
      risk: "LOW"
    });
  }

  return changes;
}

function diffSchema(
  beforeSchema: Record<string, unknown> | undefined,
  afterSchema: Record<string, unknown> | undefined,
  schemaKind: "input" | "output",
  comparisonMode: ScriptDiffComparisonMode,
  rawBeforeText?: string,
  rawAfterText?: string
): SchemaDiffSummary {
  const beforeText = rawBeforeText ?? prettyJson(beforeSchema);
  const afterText = rawAfterText ?? prettyJson(afterSchema);
  const before = toSchemaFields(beforeSchema);
  const after = toSchemaFields(afterSchema);

  const addedFields: SchemaFieldChange[] = [];
  const removedFields: SchemaFieldChange[] = [];
  const modifiedFields: SchemaFieldModification[] = [];

  if (comparisonMode === "INITIAL") {
    for (const field of after.fields.values()) {
      addedFields.push({
        name: field.name,
        type: field.type,
        required: field.required,
        description: field.description,
        risk: "LOW"
      });
    }
  } else {
    for (const [name, beforeField] of before.fields.entries()) {
      const afterField = after.fields.get(name);
      if (!afterField) {
        removedFields.push({
          name,
          type: beforeField.type,
          required: beforeField.required,
          description: beforeField.description,
          risk: "HIGH"
        });
        continue;
      }

      const propertyChanges = buildSchemaPropertyChanges(beforeField, afterField, schemaKind);
      if (propertyChanges.length > 0) {
        modifiedFields.push({
          name,
          changes: propertyChanges
        });
      }
    }

    for (const [name, afterField] of after.fields.entries()) {
      if (before.fields.has(name)) {
        continue;
      }
      addedFields.push({
        name,
        type: afterField.type,
        required: afterField.required,
        description: afterField.description,
        risk:
          schemaKind === "input"
            ? afterField.required
              ? "HIGH"
              : "LOW"
            : "LOW"
      });
    }
  }

  const rawChanged = beforeText !== afterText;
  const changed =
    comparisonMode === "INITIAL"
      ? Boolean(afterText.trim() || addedFields.length > 0)
      : rawChanged || !sameValue(beforeSchema ?? {}, afterSchema ?? {});

  const risk = maxRisk(
    ...addedFields.map((field) => field.risk),
    ...removedFields.map((field) => field.risk),
    ...modifiedFields.flatMap((field) => field.changes.map((change) => change.risk)),
    before.fallbackToRaw || after.fallbackToRaw
      ? changed
        ? "MEDIUM"
        : "LOW"
      : undefined
  );

  return {
    available: true,
    changed,
    risk,
    addedFields,
    removedFields,
    modifiedFields,
    fallbackToRaw: before.fallbackToRaw || after.fallbackToRaw,
    rawBeforeText: beforeText,
    rawAfterText: afterText,
    warnings: [...before.warnings, ...after.warnings]
  };
}

function diffMetadata(
  base: ScriptDiffTarget | undefined,
  target: ScriptDiffTarget,
  context: ScriptDiffContext,
  comparisonMode: ScriptDiffComparisonMode
): MetadataDiffSummary {
  const fields =
    context === "publish"
      ? [
          { field: "name", label: "名称", risk: "LOW" as RiskLevel, normalize: normalizeOptionalTextValue },
          { field: "type", label: "类型", risk: "HIGH" as RiskLevel },
          { field: "packaging", label: "打包属性", risk: "HIGH" as RiskLevel },
          {
            field: "pythonRequirements",
            label: "Python 依赖",
            risk: "MEDIUM" as RiskLevel,
            normalize: normalizeOptionalTextValue,
            include: shouldIncludePythonRequirementsField
          },
          { field: "description", label: "说明", risk: "LOW" as RiskLevel, normalize: normalizeOptionalTextValue },
          { field: "owner", label: "Owner", risk: "LOW" as RiskLevel, normalize: normalizeOptionalTextValue },
          { field: "tags", label: "标签", risk: "LOW" as RiskLevel, normalize: normalizeStringArray }
        ]
      : [
          { field: "name", label: "名称", risk: "LOW" as RiskLevel, normalize: normalizeOptionalTextValue },
          { field: "type", label: "类型", risk: "HIGH" as RiskLevel },
          { field: "packaging", label: "打包属性", risk: "HIGH" as RiskLevel },
          {
            field: "pythonRequirements",
            label: "Python 依赖",
            risk: "MEDIUM" as RiskLevel,
            normalize: normalizeOptionalTextValue,
            include: shouldIncludePythonRequirementsField
          },
          { field: "description", label: "说明", risk: "LOW" as RiskLevel, normalize: normalizeOptionalTextValue },
          { field: "owner", label: "Owner", risk: "LOW" as RiskLevel, normalize: normalizeOptionalTextValue },
          { field: "tags", label: "标签", risk: "LOW" as RiskLevel, normalize: normalizeStringArray }
        ];

  const changes = fields
    .map((item) => {
      if (item.include && !item.include(base, target)) {
        return null;
      }
      const beforeRaw = base?.[item.field as keyof ScriptDiffTarget];
      const afterRaw = target[item.field as keyof ScriptDiffTarget];
      const before = item.normalize ? item.normalize(beforeRaw) : beforeRaw;
      const after = item.normalize ? item.normalize(afterRaw) : afterRaw;
      if (comparisonMode !== "INITIAL" && sameValue(before, after)) {
        return null;
      }
      return {
        field: item.field,
        label: item.label,
        before,
        after,
        risk: comparisonMode === "INITIAL" ? "LOW" : item.risk
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    available: true,
    changed: changes.length > 0,
    risk: maxRisk(...changes.map((change) => change.risk)),
    changes
  };
}

function shouldIncludePythonRequirementsField(
  base: ScriptDiffTarget | undefined,
  target: ScriptDiffTarget
): boolean {
  return base?.type === "PYTHON"
    || target.type === "PYTHON"
    || Boolean(normalizeOptionalTextValue(base?.pythonRequirements))
    || Boolean(normalizeOptionalTextValue(target.pythonRequirements));
}

function normalizePluginDependencyKey(dependency: PluginDependency): string {
  return `plugin:${dependency.pluginId}`;
}

function normalizePluginDependencyChange(
  dependency: PluginDependency,
  risk: RiskLevel
): DependencyChange {
  return {
    dependencyType: "PLUGIN",
    dependencyId: dependency.pluginId,
    versionRange: dependency.versionRange,
    requiredActions: [...dependency.requiredActions].sort(),
    risk
  };
}

function normalizeScriptDependencyKey(dependency: ScriptDependency): string {
  return `script:${dependency.repositoryId}:${dependency.repositoryScriptId}`;
}

function normalizeScriptDependencyChange(
  dependency: ScriptDependency,
  risk: RiskLevel
): DependencyChange {
  return {
    dependencyType: "SCRIPT",
    dependencyId: dependency.scriptId,
    target: `${dependency.repositoryId}/${dependency.repositoryScriptId}`,
    versionRange: dependency.versionRange,
    requiredActions: [],
    risk
  };
}

function normalizeAiDependencies(dependencies: ScriptDiffTarget["aiDependencies"]): string[] {
  return [...(dependencies ?? [])].sort();
}

function diffDependencies(
  base: ScriptDiffTarget | undefined,
  target: ScriptDiffTarget,
  context: ScriptDiffContext,
  comparisonMode: ScriptDiffComparisonMode
): DependencyDiffSummary {
  const basePluginDependencies = new Map(
    (base?.pluginDependencies ?? []).map((dependency) => [normalizePluginDependencyKey(dependency), dependency])
  );
  const targetPluginDependencies = new Map(
    (target.pluginDependencies ?? []).map((dependency) => [normalizePluginDependencyKey(dependency), dependency])
  );
  const baseScriptDependencies = new Map(
    (base?.scriptDependencies ?? []).map((dependency) => [normalizeScriptDependencyKey(dependency), dependency])
  );
  const targetScriptDependencies = new Map(
    (target.scriptDependencies ?? []).map((dependency) => [normalizeScriptDependencyKey(dependency), dependency])
  );
  const baseAiDependencies = normalizeAiDependencies(base?.aiDependencies);
  const targetAiDependencies = normalizeAiDependencies(target.aiDependencies);

  const added: DependencyChange[] = [];
  const removed: DependencyChange[] = [];
  const modified: DependencyModification[] = [];
  const unchanged: DependencyChange[] = [];

  if (comparisonMode === "INITIAL") {
    for (const dependency of targetPluginDependencies.values()) {
      added.push(normalizePluginDependencyChange(dependency, "LOW"));
    }
    for (const dependency of targetScriptDependencies.values()) {
      added.push(normalizeScriptDependencyChange(dependency, "LOW"));
    }
  } else {
    for (const [key, beforeDependency] of basePluginDependencies.entries()) {
      const afterDependency = targetPluginDependencies.get(key);
      if (!afterDependency) {
        removed.push(normalizePluginDependencyChange(beforeDependency, "LOW"));
        continue;
      }

      const changes: DependencyModification["changes"] = [];
      if (!sameValue(beforeDependency.versionRange, afterDependency.versionRange)) {
        changes.push({
          field: "versionRange",
          before: beforeDependency.versionRange,
          after: afterDependency.versionRange,
          risk: "MEDIUM"
        });
      }

      const beforeActions = [...beforeDependency.requiredActions].sort();
      const afterActions = [...afterDependency.requiredActions].sort();
      if (!sameValue(beforeActions, afterActions)) {
        const removedActions = beforeActions.filter((action) => !afterActions.includes(action));
        changes.push({
          field: "requiredActions",
          before: beforeActions,
          after: afterActions,
          risk: removedActions.length > 0 ? "MEDIUM" : "LOW"
        });
      }

      if (changes.length > 0) {
        modified.push({
          dependencyType: "PLUGIN",
          dependencyId: beforeDependency.pluginId,
          changes
        });
      } else {
        unchanged.push(normalizePluginDependencyChange(afterDependency, "LOW"));
      }
    }

    for (const [key, dependency] of targetPluginDependencies.entries()) {
      if (!basePluginDependencies.has(key)) {
        added.push(normalizePluginDependencyChange(dependency, "MEDIUM"));
      }
    }

    for (const [key, beforeDependency] of baseScriptDependencies.entries()) {
      const afterDependency = targetScriptDependencies.get(key);
      if (!afterDependency) {
        removed.push(normalizeScriptDependencyChange(beforeDependency, "LOW"));
        continue;
      }

      const changes: DependencyModification["changes"] = [];
      const beforeTarget = `${beforeDependency.repositoryId}/${beforeDependency.repositoryScriptId}`;
      const afterTarget = `${afterDependency.repositoryId}/${afterDependency.repositoryScriptId}`;
      if (!sameValue(beforeTarget, afterTarget)) {
        changes.push({
          field: "target",
          before: beforeTarget,
          after: afterTarget,
          risk: "HIGH"
        });
      }
      if (!sameValue(beforeDependency.versionRange, afterDependency.versionRange)) {
        changes.push({
          field: "versionRange",
          before: beforeDependency.versionRange,
          after: afterDependency.versionRange,
          risk: "MEDIUM"
        });
      }

      if (changes.length > 0) {
        modified.push({
          dependencyType: "SCRIPT",
          dependencyId: beforeDependency.scriptId,
          changes
        });
      } else {
        unchanged.push(normalizeScriptDependencyChange(afterDependency, "LOW"));
      }
    }

    for (const [key, dependency] of targetScriptDependencies.entries()) {
      if (!baseScriptDependencies.has(key)) {
        added.push(normalizeScriptDependencyChange(dependency, "MEDIUM"));
      }
    }

    const removedAiDependencies = baseAiDependencies.filter((item) => !targetAiDependencies.includes(item));
    const addedAiDependencies = targetAiDependencies.filter((item) => !baseAiDependencies.includes(item));
    for (const dependencyId of removedAiDependencies) {
      removed.push({
        dependencyType: "PLUGIN",
        dependencyId: `AI:${dependencyId}`,
        requiredActions: [],
        risk: "LOW"
      });
    }
    for (const dependencyId of addedAiDependencies) {
      added.push({
        dependencyType: "PLUGIN",
        dependencyId: `AI:${dependencyId}`,
        requiredActions: [],
        risk: "LOW"
      });
    }
  }

  return {
    available: true,
    changed: added.length > 0 || removed.length > 0 || modified.length > 0,
    risk: maxRisk(
      ...added.map((item) => item.risk),
      ...removed.map((item) => item.risk),
      ...modified.flatMap((item) => item.changes.map((change) => change.risk))
    ),
    added,
    removed,
    modified,
    unchanged
  };
}

function diffSource(
  beforeSource: string | undefined,
  afterSource: string | undefined,
  comparisonMode: ScriptDiffComparisonMode
): SourceDiffSummary {
  const original = normalizeText(beforeSource);
  const modified = normalizeText(afterSource);

  if (comparisonMode === "INITIAL") {
    return {
      available: true,
      changed: Boolean(modified.trim()),
      risk: "LOW",
      addedLines: countLines(modified),
      removedLines: 0,
      original,
      modified,
      matchedHighRiskKeywords: []
    };
  }

  let addedLines = 0;
  let removedLines = 0;
  const matchedKeywords = new Set<string>();

  diffLines(original, modified).forEach((part: any) => {
    const lineCount = countLines(part.value);
    if (part.added) {
      addedLines += lineCount;
      extractMatchedKeywords(part.value).forEach((keyword) => matchedKeywords.add(keyword));
      return;
    }
    if (part.removed) {
      removedLines += lineCount;
      extractMatchedKeywords(part.value).forEach((keyword) => matchedKeywords.add(keyword));
    }
  });

  const changed = original !== modified;
  const matchedHighRiskKeywords = [...matchedKeywords];

  return {
    available: true,
    changed,
    risk: !changed ? "LOW" : matchedHighRiskKeywords.length > 0 ? "HIGH" : "MEDIUM",
    addedLines,
    removedLines,
    original,
    modified,
    matchedHighRiskKeywords
  };
}

function toPublishBase(script: ScriptDefinition): ScriptDiffTarget | undefined {
  const published = script.published;
  if (!published) {
    return undefined;
  }

  return {
    name: normalizeString(published.name),
    type: published.type,
    packaging: published.packaging,
    source: published.source,
    pythonRequirements: published.pythonRequirements,
    description: normalizeString(published.description),
    owner: normalizeString(published.owner),
    tags: normalizeStringArray(published.tags),
    inputSchema: published.inputSchema,
    outputSchema: published.outputSchema,
    scriptDependencies: published.scriptDependencies,
    pluginDependencies: published.pluginDependencies,
    aiDependencies: normalizeAiDependencies(
      published.aiDependencies?.map((item) => [item.capability, item.profile ?? "", item.agentProfile ?? "", item.required ? "required" : "optional"].join(":"))
    )
  };
}

export function toDiffTarget(script: ScriptDefinition): ScriptDiffTarget {
  return {
    name: normalizeString(script.name),
    type: script.type,
    packaging: script.packaging,
    source: script.source,
    pythonRequirements: normalizeOptionalTextValue(script.pythonRequirements),
    inputSchema: script.inputSchema,
    outputSchema: script.outputSchema,
    description: normalizeString(script.description),
    owner: normalizeString(script.owner),
    tags: normalizeStringArray(script.tags),
    scriptDependencies: script.scriptDependencies,
    pluginDependencies: script.pluginDependencies,
    aiDependencies: normalizeAiDependencies(
      script.aiDependencies?.map((item) => [item.capability, item.profile ?? "", item.agentProfile ?? "", item.required ? "required" : "optional"].join(":"))
    )
  };
}

export function buildPublishDiffTarget(
  script: Partial<Pick<
    ScriptDefinition,
    | "name"
    | "type"
    | "packaging"
    | "source"
    | "inputSchema"
    | "outputSchema"
    | "description"
    | "owner"
    | "tags"
    | "scriptDependencies"
    | "pluginDependencies"
    | "pythonRequirements"
  >> & Pick<ScriptDiffTarget, "aiDependencies"> & {
    rawInputSchemaText?: string;
    rawOutputSchemaText?: string;
  }
): ScriptDiffTarget {
  return {
    name: normalizeString(script.name),
    type: script.type,
    packaging: script.packaging,
    source: script.source,
    pythonRequirements: normalizeOptionalTextValue(script.pythonRequirements),
    inputSchema: script.inputSchema,
    outputSchema: script.outputSchema,
    rawInputSchemaText: script.rawInputSchemaText,
    rawOutputSchemaText: script.rawOutputSchemaText,
    description: normalizeString(script.description),
    owner: normalizeString(script.owner),
    tags: normalizeStringArray(script.tags),
    scriptDependencies: script.scriptDependencies,
    pluginDependencies: script.pluginDependencies,
    aiDependencies: normalizeAiDependencies(script.aiDependencies)
  };
}

export function buildRepositoryPublishDiffTarget(target: ScriptDiffTarget): ScriptDiffTarget {
  return {
    name: normalizeString(target.name),
    type: target.type,
    packaging: target.packaging,
    source: target.source,
    pythonRequirements: normalizeOptionalTextValue(target.pythonRequirements),
    description: normalizeString(target.description),
    owner: normalizeString(target.owner),
    tags: normalizeStringArray(target.tags),
    scriptDependencies: target.scriptDependencies,
    pluginDependencies: target.pluginDependencies,
    aiDependencies: target.aiDependencies
  };
}

export function toRepositoryScriptDiffTarget(detail: RepositoryScriptDetail): ScriptDiffTarget {
  return {
    name: normalizeString(detail.descriptor.displayName),
    type: detail.descriptor.type,
    packaging: detail.descriptor.packaging,
    source: detail.source,
    pythonRequirements: normalizeOptionalTextValue(detail.pythonRequirements),
    description: normalizeString(detail.descriptor.description),
    owner: normalizeString(detail.descriptor.owner),
    tags: normalizeStringArray(detail.descriptor.tags),
    scriptDependencies: detail.descriptor.scriptDependencies,
    pluginDependencies: detail.descriptor.pluginDependencies,
    aiDependencies: normalizeAiDependencies(
      detail.descriptor.aiDependencies?.map((item) => [item.capability, item.profile ?? "", item.agentProfile ?? "", item.required ? "required" : "optional"].join(":"))
    )
  };
}

export function buildScriptDiff(
  base: ScriptDiffTarget | undefined,
  target: ScriptDiffTarget,
  options: BuildScriptDiffOptions
): ScriptDiffResult {
  const comparisonMode: ScriptDiffComparisonMode = base ? "COMPARE" : "INITIAL";
  const source = diffSource(base?.source, target.source, comparisonMode);
  const inputSchema = diffSchema(
    base?.inputSchema,
    target.inputSchema,
    "input",
    comparisonMode,
    base?.rawInputSchemaText,
    target.rawInputSchemaText
  );
  const outputSchema = diffSchema(
    base?.outputSchema,
    target.outputSchema,
    "output",
    comparisonMode,
    base?.rawOutputSchemaText,
    target.rawOutputSchemaText
  );
  const metadata = diffMetadata(base, target, options.context, comparisonMode);
  const dependencies = diffDependencies(base, target, options.context, comparisonMode);

  const warnings = [...inputSchema.warnings, ...outputSchema.warnings];
  const highlights: string[] = [];

  if (comparisonMode === "INITIAL") {
    highlights.push("首次发布或首次导入，不涉及已发布兼容性对比。");
  }
  if (source.matchedHighRiskKeywords.length > 0) {
    highlights.push(`源码变更命中高风险关键词：${source.matchedHighRiskKeywords.join(", ")}`);
  }
  removedSummary(inputSchema, "Input Schema").forEach((item) => highlights.push(item));
  removedSummary(outputSchema, "Output Schema").forEach((item) => highlights.push(item));
  highRiskModifiedSummary(inputSchema, "Input Schema").forEach((item) => highlights.push(item));
  highRiskModifiedSummary(outputSchema, "Output Schema").forEach((item) => highlights.push(item));
  if (metadata.changes.some((change) => change.field === "type" && change.risk === "HIGH")) {
    highlights.push("脚本类型发生变化。");
  }
  if (metadata.changes.some((change) => change.field === "packaging" && change.risk === "HIGH")) {
    highlights.push("脚本打包属性发生变化。");
  }

  const tabs: DiffTabKey[] = ["source", "inputSchema", "outputSchema", "metadata"];
  if (dependencies.available) {
    tabs.push("dependencies");
  }

  const hasChanges =
    source.changed ||
    inputSchema.changed ||
    outputSchema.changed ||
    metadata.changed ||
    dependencies.changed;

  return {
    comparisonMode,
    context: options.context,
    hasChanges,
    riskLevel: comparisonMode === "INITIAL"
      ? "LOW"
      : maxRisk(source.risk, inputSchema.risk, outputSchema.risk, metadata.risk, dependencies.risk),
    highlights,
    warnings,
    tabs,
    source,
    inputSchema,
    outputSchema,
    metadata,
    dependencies
  };
}

function removedSummary(summary: SchemaDiffSummary, label: string): string[] {
  return summary.removedFields
    .filter((field) => field.risk === "HIGH")
    .map((field) => `${label} 删除字段 ${field.name}`);
}

function highRiskModifiedSummary(summary: SchemaDiffSummary, label: string): string[] {
  return summary.modifiedFields.flatMap((field) =>
    field.changes
      .filter((change) => change.risk === "HIGH")
      .map((change) => `${label} 字段 ${field.name} 的 ${change.property} 发生高风险变化`)
  );
}

export function buildPublishScriptDiff(script: ScriptDefinition, target: ScriptDiffTarget): ScriptDiffResult {
  return buildScriptDiff(toPublishBase(script), target, { context: "publish" });
}
