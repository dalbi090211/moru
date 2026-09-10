import type { Edge, Graph } from "../types.gen.ts";
import { NODE_SPECS, type NodeKind } from "../nodes/specs.ts";

/**
 * 그래프 편집은 예외 없이 여기를 거친다.
 * 사람의 GUI 조작과 AI의 편집이 같은 경로를 타야 검증/undo/히스토리가 공짜로 붙는다.
 *
 * applyCommand는 immer draft를 제자리에서 고친다. 도중에 throw하면 immer가
 * 통째로 버리므로 여러 command를 묶어도 전부 적용되거나 전부 안 되거나다.
 */

export type GraphNode = Graph["nodes"][number];
export type NodeId = string;
export type GraphState = { nodes: GraphNode[]; edges: Edge[] };

export type Command =
  | { op: "add_node"; node: GraphNode }
  | { op: "insert_nodes"; after: NodeId; nodes: GraphNode[] }
  | { op: "connect"; src: NodeId; dst: NodeId }
  | { op: "disconnect"; src: NodeId; dst: NodeId }
  | { op: "set_param"; id: NodeId; key: string; value: unknown }
  | { op: "move_node"; id: NodeId; x: number; y: number }
  | { op: "delete"; ids: NodeId[] };

export class CommandError extends Error {}

const find = (g: GraphState, id: NodeId): GraphNode => {
  const n = g.nodes.find((n) => n.id === id);
  if (!n) throw new CommandError(`없는 노드: '${id}'`);
  return n;
};

/** src에서 엣지를 따라가 dst에 닿는가. connect가 사이클을 만드는지 볼 때 쓴다. */
function reaches(g: GraphState, from: NodeId, to: NodeId): boolean {
  const seen = new Set<NodeId>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of g.edges) if (e.src === cur) stack.push(e.dst);
  }
  return false;
}

function connect(g: GraphState, src: NodeId, dst: NodeId): void {
  find(g, src);
  find(g, dst);
  if (src === dst) throw new CommandError(`'${src}'를 자기 자신에 연결할 수 없다.`);
  if (g.edges.some((e) => e.dst === dst))
    throw new CommandError(`'${dst}'에는 이미 입력이 있다. 다입력 노드는 아직 없다.`);
  if (reaches(g, dst, src)) throw new CommandError(`'${src}' -> '${dst}'는 사이클을 만든다.`);
  g.edges.push({ src, dst });
}

function disconnect(g: GraphState, src: NodeId, dst: NodeId): void {
  const i = g.edges.findIndex((e) => e.src === src && e.dst === dst);
  if (i < 0) throw new CommandError(`없는 엣지: '${src}' -> '${dst}'`);
  g.edges.splice(i, 1);
}

function addNode(g: GraphState, node: GraphNode): void {
  if (g.nodes.some((n) => n.id === node.id))
    throw new CommandError(`이미 있는 노드 id: '${node.id}'`);
  if (!(node.type in NODE_SPECS)) throw new CommandError(`모르는 노드 타입: '${node.type}'`);
  g.nodes.push(node);
}

export function applyCommand(g: GraphState, cmd: Command): void {
  switch (cmd.op) {
    case "add_node":
      return addNode(g, cmd.node);

    case "insert_nodes": {
      // after 노드 뒤에 체인을 끼워 넣는다. AI가 "여기 conv 2개 넣어줘" 할 때 쓰는 것.
      if (cmd.nodes.length === 0) throw new CommandError("insert_nodes: 노드가 비었다.");
      find(g, cmd.after);
      const tail = g.edges.find((e) => e.src === cmd.after)?.dst;
      if (tail !== undefined) disconnect(g, cmd.after, tail);
      for (const n of cmd.nodes) addNode(g, n);
      const chain = [cmd.after, ...cmd.nodes.map((n) => n.id)];
      if (tail !== undefined) chain.push(tail);
      for (let i = 0; i + 1 < chain.length; i++) connect(g, chain[i], chain[i + 1]);
      return;
    }

    case "connect":
      return connect(g, cmd.src, cmd.dst);

    case "disconnect":
      return disconnect(g, cmd.src, cmd.dst);

    case "set_param": {
      const node = find(g, cmd.id);
      const spec = NODE_SPECS[node.type as NodeKind];
      if (!(cmd.key in spec.params))
        throw new CommandError(`'${node.type}'에 없는 파라미터: '${cmd.key}'`);
      (node as unknown as Record<string, unknown>)[cmd.key] = cmd.value;
      return;
    }

    case "move_node": {
      find(g, cmd.id).ui = { x: cmd.x, y: cmd.y };
      return;
    }

    case "delete": {
      for (const id of cmd.ids) find(g, id);
      const gone = new Set(cmd.ids);
      g.nodes = g.nodes.filter((n) => !gone.has(n.id));
      g.edges = g.edges.filter((e) => !gone.has(e.src) && !gone.has(e.dst));
      return;
    }
  }
}
