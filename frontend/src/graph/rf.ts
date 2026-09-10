import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { Edge } from "../types.gen.ts";
import type { GraphNode, GraphState } from "./commands.ts";
import { inferShapes, type Shape } from "./shapes.ts";

/**
 * 변환 계층. 진실은 스키마 형태(파라미터가 노드에 평평하게 붙은 것)고, React Flow에
 * 줄 때만 data.params로 감싼다. 반대 방향 변환은 없다 — 편집이 전부 command로 가므로
 * RF 노드를 스키마로 되옮길 일이 없다.
 */
export const toRFNode = (n: GraphNode, shape?: Shape, error?: string): RFNode => {
  const { id, type, ui, ...params } = n;
  return { id, type, position: ui ?? { x: 0, y: 0 }, data: { params, shape, error } };
};

export const toRFEdge = (e: Edge): RFEdge => ({
  id: `${e.src}->${e.dst}`,
  source: e.src,
  target: e.dst,
});

/**
 * 스토어 -> 캔버스 단방향 동기화. 이미 캔버스에 있던 노드는 껍데기를 물려받는다.
 *
 * RF는 measured(실측 크기)가 없는 노드를 visibility:hidden으로 그리고 handleBounds도
 * 버린다(adoptUserNodes). 매번 노드를 통째로 새로 만들면 프레임마다 전부 숨었다
 * 나타난다 = 캔버스 깜빡임. 선택 상태처럼 RF가 들고 있는 UI 상태도 여기서 같이 산다.
 */
export const syncRFNodes = (prev: RFNode[], g: GraphState): RFNode[] => {
  const { shapes, errors } = inferShapes(g);
  const kept = new Map(prev.map((n) => [n.id, n]));
  return g.nodes.map((n) => {
    const next = toRFNode(n, shapes.get(n.id), errors.get(n.id));
    const old = kept.get(n.id);
    return old ? { ...old, ...next } : next;
  });
};
