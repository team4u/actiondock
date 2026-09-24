import type { JsonValue } from "@actiondock/sdk";
import {
  inputPathConflict,
  flatInputLimitExceeded,
  invalidFlatArgument,
} from "./flat-errors";
import { isForbiddenActionInputPropertyName } from "./flat-predicates";
import { DEFAULT_MAX_MATERIALIZED_SIZE_BYTES } from "./flat-parser";
import type { FlatAssignment } from "./flat-parser";
import { validateJsonValue } from "../json/value-validator";

/**
 * 节点状态枚举（四态节点模型）。
 */
export const NodeState = {
  UNSET: "UNSET",
  OBJECT: "OBJECT",
  ARRAY: "ARRAY",
  VALUE: "VALUE",
} as const;

export type NodeState = (typeof NodeState)[keyof typeof NodeState];

/**
 * 物化配置选项。
 */
export interface FlatMaterializerOptions {
  maxMaterializedSizeBytes?: number;
}

interface IntermediateNode {
  state: NodeState;
  pathStr: string;
  objectChildren: Record<string, IntermediateNode>;
  arrayChildren: Map<number, IntermediateNode>;
  value?: JsonValue;
}

function createNode(pathStr: string, state: NodeState = NodeState.UNSET): IntermediateNode {
  return {
    state,
    pathStr,
    objectChildren: Object.create(null),
    arrayChildren: new Map(),
    value: undefined,
  };
}

function materializeNode(node: IntermediateNode): JsonValue {
  switch (node.state) {
    case NodeState.VALUE:
      return node.value!;

    case NodeState.OBJECT: {
      const result: Record<string, JsonValue> = {};
      const keys = Object.keys(node.objectChildren).sort();
      for (const key of keys) {
        result[key] = materializeNode(node.objectChildren[key]);
      }
      return result;
    }

    case NodeState.ARRAY: {
      const count = node.arrayChildren.size;
      if (count === 0) {
        return [];
      }
      const result: JsonValue[] = [];
      for (let i = 0; i < count; i++) {
        const child = node.arrayChildren.get(i);
        if (!child) {
          throw inputPathConflict(
            `Sparse array detected at "${node.pathStr}": missing index ${i}`,
            { path: node.pathStr, missingIndex: i, reason: "SPARSE_ARRAY" }
          );
        }
        result.push(materializeNode(child));
      }
      return result;
    }

    case NodeState.UNSET:
    default:
      throw inputPathConflict(
        `Incomplete intermediate node at "${node.pathStr}"`,
        { path: node.pathStr, reason: "INCOMPLETE_CONTAINER" }
      );
  }
}

/**
 * 将扁平赋值表达式列表物化为标准 JSON 值对象。
 *
 * 安全规范：
 * - 错误信息与 details 中严禁回显原始 raw、rawValue 或完整 token，仅保留 path、operator、valueLength。
 *
 * @param assignments 扁平赋值表达式列表
 * @param options 物化配置选项
 * @returns 物化后的 JSON 对象
 */
export function materializeFlatInput(
  assignments: FlatAssignment[],
  options?: FlatMaterializerOptions
): JsonValue {
  const root = createNode("", NodeState.OBJECT);

  /**
   * 叶子赋值四态推进（字符串段与数字段共用单一事实源）。
   * - UNSET：置为 VALUE 并写入值；
   * - VALUE：重复赋值，抛 DUPLICATE_ASSIGNMENT；
   * - OBJECT/ARRAY：值写入既有容器，抛 LEAF_CONTAINER_CONFLICT。
   */
  const assignLeaf = (
    child: IntermediateNode,
    currentPathStr: string,
    operator: FlatAssignment["operator"],
    value: JsonValue,
    valueLength: number
  ): void => {
    if (child.state === NodeState.UNSET) {
      child.state = NodeState.VALUE;
      child.value = value;
    } else if (child.state === NodeState.VALUE) {
      throw inputPathConflict(
        `Duplicate assignment to leaf path "${currentPathStr}"`,
        { path: currentPathStr, operator, valueLength, reason: "DUPLICATE_ASSIGNMENT" }
      );
    } else {
      throw inputPathConflict(
        `Path conflict at "${currentPathStr}": cannot assign value to existing container (${child.state.toLowerCase()})`,
        { path: currentPathStr, operator, valueLength, reason: "LEAF_CONTAINER_CONFLICT" }
      );
    }
  };

  /**
   * 容器下钻三态推进（字符串段与数字段共用单一事实源）。
   * - UNSET：按下一路径段形态初始化为 OBJECT 或 ARRAY；
   * - VALUE：穿透既有值节点，抛 LEAF_CONTAINER_CONFLICT；
   * - 容器形态与期望不符：抛 OBJECT_ARRAY_CONFLICT。
   * 错误消息中下一访问段的措辞由 accessNoun 提供（字符串段为 property，数字段为 index/property）。
   */
  const descend = (
    child: IntermediateNode,
    currentPathStr: string,
    nextSeg: string | number,
    operator: FlatAssignment["operator"],
    valueLength: number,
    accessNoun: "property" | "index/property"
  ): IntermediateNode => {
    const nextExpectedState =
      typeof nextSeg === "number" ? NodeState.ARRAY : NodeState.OBJECT;

    if (child.state === NodeState.UNSET) {
      child.state = nextExpectedState;
    } else if (child.state === NodeState.VALUE) {
      throw inputPathConflict(
        `Path conflict at "${currentPathStr}": cannot access ${accessNoun} "${nextSeg}" on existing value`,
        { path: currentPathStr, operator, valueLength, reason: "LEAF_CONTAINER_CONFLICT" }
      );
    } else if (child.state !== nextExpectedState) {
      throw inputPathConflict(
        `Path conflict at "${currentPathStr}": expected ${nextExpectedState.toLowerCase()} but found ${child.state.toLowerCase()}`,
        { path: currentPathStr, operator, valueLength, reason: "OBJECT_ARRAY_CONFLICT" }
      );
    }

    return child;
  };

  for (const assignment of assignments) {
    const { path, value, operator, rawValue } = assignment;
    const valueLength = Buffer.byteLength(rawValue, "utf8");

    if (path.length === 0) {
      throw inputPathConflict(
        `Cannot assign value directly to root object`,
        { operator, valueLength, reason: "LEAF_CONTAINER_CONFLICT" }
      );
    }

    let current = root;

    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      const isLast = i === path.length - 1;
      const currentPathStr = path.slice(0, i + 1).join(".");

      if (typeof seg === "string") {
        if (isForbiddenActionInputPropertyName(seg)) {
          throw invalidFlatArgument(
            `Forbidden property "${seg}" in path: "${currentPathStr}"`,
            { path: currentPathStr, segment: seg, reason: "FORBIDDEN_PROPERTY" }
          );
        }

        if (current.state !== NodeState.OBJECT) {
          throw inputPathConflict(
            `Path conflict at "${current.pathStr}": expected object container but found ${current.state.toLowerCase()}`,
            { path: currentPathStr, operator, valueLength, reason: "OBJECT_ARRAY_CONFLICT" }
          );
        }

        let child = Object.hasOwn(current.objectChildren, seg)
          ? current.objectChildren[seg]
          : undefined;

        if (!child) {
          child = createNode(currentPathStr);
          current.objectChildren[seg] = child;
        }

        if (isLast) {
          assignLeaf(child, currentPathStr, operator, value, valueLength);
        } else {
          current = descend(
            child,
            currentPathStr,
            path[i + 1],
            operator,
            valueLength,
            "property"
          );
        }
      } else {
        // seg is a number
        if (current.state !== NodeState.ARRAY) {
          throw inputPathConflict(
            `Path conflict at "${current.pathStr || "root"}": expected array container but found ${current.state.toLowerCase()}`,
            {
              path: currentPathStr,
              operator,
              valueLength,
              reason: current.pathStr === "" ? "ROOT_INDEX_NOT_ALLOWED" : "OBJECT_ARRAY_CONFLICT",
            }
          );
        }

        let child = current.arrayChildren.get(seg);

        if (!child) {
          child = createNode(currentPathStr);
          current.arrayChildren.set(seg, child);
        }

        if (isLast) {
          assignLeaf(child, currentPathStr, operator, value, valueLength);
        } else {
          current = descend(
            child,
            currentPathStr,
            path[i + 1],
            operator,
            valueLength,
            "index/property"
          );
        }
      }
    }
  }

  const result = materializeNode(root);

  const check = validateJsonValue(result);
  if (!check.valid) {
    throw flatInputLimitExceeded(
      `Materialized input validation failed: ${check.reason}`,
      {
        reason:
          check.code === "MAX_JSON_DEPTH"
            ? "MAX_MATERIALIZED_JSON_DEPTH"
            : "INVALID_JSON_VALUE",
      }
    );
  }

  const maxMaterializedSizeBytes =
    options?.maxMaterializedSizeBytes ?? DEFAULT_MAX_MATERIALIZED_SIZE_BYTES;
  const serialized = JSON.stringify(result);
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > maxMaterializedSizeBytes) {
    throw flatInputLimitExceeded(
      `Materialized input size (${byteLength} bytes) exceeds limit (${maxMaterializedSizeBytes} bytes)`,
      { byteLength, maxMaterializedSizeBytes, reason: "MAX_MATERIALIZED_BYTES" }
    );
  }

  return result;
}
