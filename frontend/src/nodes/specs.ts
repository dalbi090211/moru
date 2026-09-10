import type {
  Conv2DNode,
  FlattenNode,
  InputNode,
  LinearNode,
  MaxPool2DNode,
  ReLUNode,
} from "../types.gen";

/**
 * 노드 레지스트리. 여기 항목 하나 추가 = 새 노드 추가.
 * BaseNode가 이걸 읽어서 핀과 속성 UI를 만들고, 나중에 Inspector도 같은 걸 읽는다.
 * 노드마다 컴포넌트를 손으로 만들지 않는다.
 */

export type ParamSpec =
  /** default: null = 백엔드 기본값에 맡긴다 (maxpool stride = kernel_size). */
  | { kind: "int"; label: string; default: number | null; min?: number }
  | { kind: "shape"; label: string; default: number[] };

/**
 * 노드의 파라미터 = pydantic 필드에서 id/type/ui를 뺀 것.
 * `-?`로 옵셔널을 벗겨서 기본값 있는 필드(kernel_size 등)도 spec을 강제한다.
 * pydantic 스키마가 바뀌면 gen:types 후 여기서 컴파일 에러가 난다.
 */
type ParamsOf<N> = { [K in Exclude<keyof N, "id" | "type" | "ui">]-?: ParamSpec };

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
  conv2d: {
    label: "Conv2d",
    accent: "bg-violet-600",
    inputs: 1,
    outputs: 1,
    params: {
      out_channels: { kind: "int", label: "out_channels", default: 16, min: 1 },
      kernel_size: { kind: "int", label: "kernel_size", default: 3, min: 1 },
      stride: { kind: "int", label: "stride", default: 1, min: 1 },
      padding: { kind: "int", label: "padding", default: 0, min: 0 },
    } satisfies ParamsOf<Conv2DNode>,
  },
  relu: {
    label: "ReLU",
    accent: "bg-zinc-600",
    inputs: 1,
    outputs: 1,
    params: {} satisfies ParamsOf<ReLUNode>,
  },
  maxpool2d: {
    label: "MaxPool2d",
    accent: "bg-indigo-600",
    inputs: 1,
    outputs: 1,
    params: {
      kernel_size: { kind: "int", label: "kernel_size", default: 2, min: 1 },
      stride: { kind: "int", label: "stride", default: null, min: 1 },
    } satisfies ParamsOf<MaxPool2DNode>,
  },
  flatten: {
    label: "Flatten",
    accent: "bg-slate-600",
    inputs: 1,
    outputs: 1,
    params: {} satisfies ParamsOf<FlattenNode>,
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
} satisfies Record<string, NodeSpec>;

export type NodeKind = keyof typeof NODE_SPECS;

export type NodeData = { params: Record<string, unknown> };

/** spec의 기본값으로 파라미터 한 벌을 만든다. */
export function defaultParams(kind: NodeKind): NodeData["params"] {
  return Object.fromEntries(
    Object.entries(NODE_SPECS[kind].params).map(([key, spec]) => [key, spec.default]),
  );
}
