import type { GraphNode, GraphState, NodeId } from "./commands.ts";

/** 노드 한 칸. BaseNode 실제 크기보다 넉넉하게 잡는다. */
const GAP_Y = 130;
const GAP_X = 220;

/**
 * ui 좌표가 없는 노드를 위상 순서대로 세로로 놓는다. 좌표가 이미 있으면 건드리지 않는다.
 * 로드할 때 한 번 돌고 결과가 스토어에 ui로 박힌다 — 그래야 저장할 때 같이 나간다.
 *
 * ponytail: 깊이 = 세로 한 칸, 같은 깊이 = 가로 한 칸. Inception처럼 브랜치가
 * 굵어져서 겹치기 시작하면 그때 dagre를 붙인다.
 */
export function autoLayout(g: GraphState): GraphNode[] {
  const pred = new Map<NodeId, NodeId>();
  for (const e of g.edges) pred.set(e.dst, e.src);

  const depth = new Map<NodeId, number>();
  const depthOf = (id: NodeId, seen: Set<NodeId>): number => {
    const memo = depth.get(id);
    if (memo !== undefined) return memo;
    const up = pred.get(id);
    // 사이클은 command가 막지만, 여기서 돌면 UI 스레드가 멈춘다
    const d = up === undefined || seen.has(id) ? 0 : depthOf(up, seen.add(id)) + 1;
    depth.set(id, d);
    return d;
  };

  const used = new Map<number, number>(); // 깊이별로 몇 칸 썼는지
  return g.nodes.map((n) => {
    if (n.ui) return n;
    const d = depthOf(n.id, new Set());
    const col = used.get(d) ?? 0;
    used.set(d, col + 1);
    return { ...n, ui: { x: col * GAP_X, y: d * GAP_Y } };
  });
}
