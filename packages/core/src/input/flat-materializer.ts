import type { JsonValue } from "@actiondock/sdk";
import { inputPathConflict, flatInputLimitExceeded } from "./flat-errors";
import { DEFAULT_MAX_MATERIALIZED_SIZE_BYTES } from "./flat-parser";
import type { FlatAssignment } from "./flat-parser";

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
            { path: node.pathStr, missingIndex: i }
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
        { path: node.pathStr }
      );
  }
}

/**
 * 将扁平赋值表达式列表物化为标准 JSON 值对象。
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

  for (const assignment of assignments) {
    const { path, value, raw } = assignment;

    if (path.length === 0) {
      throw inputPathConflict(
        `Cannot assign value directly to root object: "${raw}"`,
        { raw }
      );
    }

    let current = root;

    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      const isLast = i === path.length - 1;
      const currentPathStr = path.slice(0, i + 1).join(".");

      if (typeof seg === "string") {
        if (current.state !== NodeState.OBJECT) {
          throw inputPathConflict(
            `Path conflict at "${current.pathStr}": expected object container but found ${current.state.toLowerCase()}`,
            { path: currentPathStr, raw }
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
          if (child.state === NodeState.UNSET) {
            child.state = NodeState.VALUE;
            child.value = value;
          } else if (child.state === NodeState.VALUE) {
            throw inputPathConflict(
              `Duplicate assignment to leaf path "${currentPathStr}": "${raw}"`,
              { path: currentPathStr, raw }
            );
          } else {
            throw inputPathConflict(
              `Path conflict at "${currentPathStr}": cannot assign value to existing container (${child.state.toLowerCase()})`,
              { path: currentPathStr, raw }
            );
          }
        } else {
          const nextSeg = path[i + 1];
          const nextExpectedState =
            typeof nextSeg === "number" ? NodeState.ARRAY : NodeState.OBJECT;

          if (child.state === NodeState.UNSET) {
            child.state = nextExpectedState;
          } else if (child.state === NodeState.VALUE) {
            throw inputPathConflict(
              `Path conflict at "${currentPathStr}": cannot access property "${nextSeg}" on existing value`,
              { path: currentPathStr, raw }
            );
          } else if (child.state !== nextExpectedState) {
            throw inputPathConflict(
              `Path conflict at "${currentPathStr}": expected ${nextExpectedState.toLowerCase()} but found ${child.state.toLowerCase()}`,
              { path: currentPathStr, raw }
            );
          }

          current = child;
        }
      } else {
        // seg is a number
        if (current.state !== NodeState.ARRAY) {
          throw inputPathConflict(
            `Path conflict at "${current.pathStr || "root"}": expected array container but found ${current.state.toLowerCase()}`,
            { path: currentPathStr, raw }
          );
        }

        let child = current.arrayChildren.get(seg);

        if (!child) {
          child = createNode(currentPathStr);
          current.arrayChildren.set(seg, child);
        }

        if (isLast) {
          if (child.state === NodeState.UNSET) {
            child.state = NodeState.VALUE;
            child.value = value;
          } else if (child.state === NodeState.VALUE) {
            throw inputPathConflict(
              `Duplicate assignment to leaf path "${currentPathStr}": "${raw}"`,
              { path: currentPathStr, raw }
            );
          } else {
            throw inputPathConflict(
              `Path conflict at "${currentPathStr}": cannot assign value to existing container (${child.state.toLowerCase()})`,
              { path: currentPathStr, raw }
            );
          }
        } else {
          const nextSeg = path[i + 1];
          const nextExpectedState =
            typeof nextSeg === "number" ? NodeState.ARRAY : NodeState.OBJECT;

          if (child.state === NodeState.UNSET) {
            child.state = nextExpectedState;
          } else if (child.state === NodeState.VALUE) {
            throw inputPathConflict(
              `Path conflict at "${currentPathStr}": cannot access index/property "${nextSeg}" on existing value`,
              { path: currentPathStr, raw }
            );
          } else if (child.state !== nextExpectedState) {
            throw inputPathConflict(
              `Path conflict at "${currentPathStr}": expected ${nextExpectedState.toLowerCase()} but found ${child.state.toLowerCase()}`,
              { path: currentPathStr, raw }
            );
          }

          current = child;
        }
      }
    }
  }

  const result = materializeNode(root);

  const maxMaterializedSizeBytes =
    options?.maxMaterializedSizeBytes ?? DEFAULT_MAX_MATERIALIZED_SIZE_BYTES;
  const serialized = JSON.stringify(result);
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > maxMaterializedSizeBytes) {
    throw flatInputLimitExceeded(
      `Materialized input size (${byteLength} bytes) exceeds limit (${maxMaterializedSizeBytes} bytes)`,
      { byteLength, maxMaterializedSizeBytes }
    );
  }

  return result;
}
