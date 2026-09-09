import type { InputNode, LinearNode, ReLUNode } from "../types.gen";

/**
 * 노드 레지스트리. 여기 항목 하나 추가 = 새 노드 추가.
 * BaseNode가 이걸 읽어서 핀과 속성 UI를 만들고, 나중에 Inspector도 같은 걸 읽는다.
 * 노드마다 컴포넌트를 손으로 만들지 않는다.
 */

export type ParamSpec =
  | { kind: "int"; label: string; default: number; min?: number }
  | { kind: "shape"; label: string; default: number[] };

/**
 * 노드의 파라미터 = pydantic 필드에서 id/type을 뺀 것.
 * `-?`로 옵셔널을 벗겨서 기본값 있는 필드(kernel_size 등)도 spec을 강제한다.
 * pydantic 스키마가 바뀌면 gen:types 후 여기서 컴파일 에러가 난다.
 */
type ParamsOf<N> = { [K in Exclude<keyof N, "id" | "type">]-?: ParamSpec };

export type NodeSpec = {
  label: string;
  accent: string;
  inputs: 0 | 1;
  outputs: 0 | 1;
  params: Record<string, ParamSpec>;
};

export const NODE_SPECS = {
  input: {
    label: "Input",
    accent: "bg-emerald-600",
    inputs: 0,
    outputs: 1,
    params: {
      shape: { kind: "shape", label: "shape", default: [1, 28, 28] },
    } satisfies ParamsOf<InputNode>,
  },
  linear: {
    label: "Linear",
    accent: "bg-sky-600",
    inputs: 1,
    outputs: 1,
    params: {
      out_features: { kind: "int", label: "out_features", default: 128, min: 1 },
    } satisfies ParamsOf<LinearNode>,
  },
  relu: {
    label: "ReLU",
    accent: "bg-zinc-600",
    inputs: 1,
    outputs: 1,
    params: {} satisfies ParamsOf<ReLUNode>,
  },
} satisfies Record<string, NodeSpec>;

export type NodeKind = keyof typeof NODE_SPECS;

export type NodeData = { params: Record<string, unknown> };

/** spec의 기본값으로 파라미터 한 벌을 만든다. */
export function defaultParams(kind: NodeKind): NodeData["params"] {
  return Object.fromEntries(
    Object.entries(NODE_SPECS[kind].params).map(([key, spec]) => [key, spec.default]),
  );
}
