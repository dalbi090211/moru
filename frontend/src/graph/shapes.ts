import type { GraphNode, GraphState, NodeId } from "./commands.ts";
import { connectError } from "./commands.ts";

/**
 * shape 추론. **backend/compile.py의 _build / _conv_hw와 같은 공식이다.**
 * 한쪽만 고치면 캔버스에서는 연결되는데 학습이 터진다.
 * examples/shape_cases.json이 양쪽을 묶어두고 있으니 공식을 바꾸면 거기부터 고칠 것.
 *
 * 서버 왕복 없이 즉각 피드백을 주려고 일부러 중복 구현한 것이다 (CLAUDE.md 3번).
 * 최종 검증은 학습 시작 전 서버가 한 번 더 한다.
 */

export type Shape = number[];

export class ShapeError extends Error {}

/** python의 //는 내림이다. Math.trunc를 쓰면 커널이 입력보다 클 때(음수) 결과가 갈린다. */
const convHW = (id: string, hw: [number, number], k: number, stride: number, pad: number) => {
  const out = hw.map((d) => Math.floor((d + 2 * pad - k) / stride) + 1);
  if (out.some((d) => d < 1))
    throw new ShapeError(
      `'${id}': 입력 [${hw}]에 kernel=${k} stride=${stride} padding=${pad}를 적용하면 ` +
        `출력이 [${out}]가 된다. 커널이 입력보다 크다.`,
    );
  return out;
};

/** 노드 하나의 출력 shape. 기본값은 pydantic 필드 기본값과 같이 유지할 것. */
export function outputShape(node: GraphNode, input: Shape | null): Shape {
  const need = (rank: number): Shape => {
    if (input === null || input.length !== rank)
      throw new ShapeError(
        `'${node.id}'(${node.type})는 ${rank}D 입력이 필요한데 ${input ? `[${input}]` : "입력 없음"}을 받았다.`,
      );
    return input;
  };
  const needAny = (): Shape => {
    if (input === null) throw new ShapeError(`'${node.id}'에 입력이 없다.`);
    return input;
  };

  switch (node.type) {
    case "input":
      if (![1, 3].includes(node.shape.length) || node.shape.some((d) => d <= 0))
        throw new ShapeError(`'${node.id}' input shape이 이상하다: [${node.shape}]`);
      return [...node.shape];

    case "conv2d": {
      const [, h, w] = need(3);
      const k = node.kernel_size ?? 3;
      return [
        node.out_channels,
        ...convHW(node.id, [h, w], k, node.stride ?? 1, node.padding ?? 0),
      ];
    }

    case "maxpool2d": {
      const [c, h, w] = need(3);
      const k = node.kernel_size ?? 2;
      // stride 없으면 kernel_size (PyTorch 규칙). python의 `or`와 같게 || 를 쓴다.
      return [c, ...convHW(node.id, [h, w], k, node.stride || k, 0)];
    }

    case "relu":
      return needAny();

    case "flatten":
      return [needAny().reduce((a, b) => a * b, 1)];

    case "linear":
      need(1);
      return [node.out_features];
  }
}

/**
 * 그래프 전체의 노드별 출력 shape. 편집 중에는 늘 연결이 덜 된 상태라
 * 상류 shape을 모르는 노드는 조용히 비워둔다 (에러로 칠하지 않는다).
 */
export function inferShapes(g: GraphState): {
  shapes: Map<NodeId, Shape>;
  errors: Map<NodeId, string>;
} {
  const pred = new Map<NodeId, NodeId>();
  for (const e of g.edges) pred.set(e.dst, e.src);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const shapes = new Map<NodeId, Shape>();
  const errors = new Map<NodeId, string>();
  const visiting = new Set<NodeId>(); // command가 사이클을 막지만 UI 스레드를 걸진 말자

  const visit = (n: GraphNode): Shape | null => {
    if (shapes.has(n.id)) return shapes.get(n.id) ?? null;
    if (errors.has(n.id) || visiting.has(n.id)) return null;
    visiting.add(n.id);
    try {
      const src = pred.get(n.id);
      const up = src === undefined ? undefined : byId.get(src);
      const input = up ? visit(up) : null;
      if (src !== undefined && input === null) return null; // 상류가 아직 모름
      const out = outputShape(n, input);
      shapes.set(n.id, out);
      return out;
    } catch (e) {
      errors.set(n.id, e instanceof ShapeError ? e.message : String(e));
      return null;
    } finally {
      visiting.delete(n.id);
    }
  };

  for (const n of g.nodes) visit(n);
  return { shapes, errors };
}

/**
 * 이 연결을 그어도 되는가. 구조(없는 노드/자기연결/다중입력/사이클)는 command와
 * 같은 규칙을 쓰고, 거기에 shape을 얹는다. 이유가 없으면 null.
 */
export function connectionError(g: GraphState, src: NodeId, dst: NodeId): string | null {
  const structural = connectError(g, src, dst);
  if (structural) return structural;

  const input = inferShapes(g).shapes.get(src);
  if (input === undefined) return null; // 상류 shape을 모르면 막지 않는다
  const dstNode = g.nodes.find((n) => n.id === dst);
  if (!dstNode) return null;
  try {
    outputShape(dstNode, input);
    return null;
  } catch (e) {
    return e instanceof ShapeError ? e.message : String(e);
  }
}
