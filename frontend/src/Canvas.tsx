import { useEffect, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import BaseNode from "./nodes/BaseNode";
import { NODE_SPECS, type NodeKind } from "./nodes/specs";
import { addNodeAt, useGraphStore } from "./graph/graphStore";
import { syncRFNodes, toRFEdge } from "./graph/rf";
import { connectionError } from "./graph/shapes";
import { NodeList } from "./panels";
import type { Command } from "./graph/commands";

// spec 하나당 컴포넌트 하나를 손으로 등록하지 않는다. 전부 BaseNode로 보낸다.
const nodeTypes = Object.fromEntries(Object.keys(NODE_SPECS).map((k) => [k, BaseNode]));

export default function Canvas() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const run = useGraphStore((s) => s.run);
  const { screenToFlowPosition } = useReactFlow();

  // 캔버스가 들고 있는 사본. 그래프 편집은 여전히 command로만 간다 — 여기 사는 건
  // 선택, 실측 크기, 드래그 중 위치처럼 RF가 프레임 단위로 만지는 것들뿐이다.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  useEffect(
    () => setRfNodes((prev) => syncRFNodes(prev, { nodes, edges })),
    [nodes, edges, setRfNodes],
  );
  useEffect(() => setRfEdges(edges.map(toRFEdge)), [edges, setRfEdges]);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // 드래그 중에는 RF가 사본만 움직인다. 스토어에는 놓을 때 한 번,
  // 같이 끌린 노드까지 한 트랜잭션으로 간다 (Ctrl+Z 한 번에 전부 제자리).
  const onNodeDragStop = (_e: unknown, _n: RFNode, dragged: RFNode[]) =>
    run(...dragged.map((n): Command => ({ op: "move_node", id: n.id, ...n.position })));

  // Delete/Backspace와 우클릭 메뉴가 모두 여기로 온다.
  const onDelete = ({ nodes: dn, edges: de }: { nodes: RFNode[]; edges: RFEdge[] }) => {
    const gone = new Set(dn.map((n) => n.id));
    run(
      { op: "delete", ids: [...gone] },
      // 노드에 딸린 엣지는 delete가 이미 지운다. 엣지만 지운 경우만 남긴다.
      ...de
        .filter((e) => !gone.has(e.source) && !gone.has(e.target))
        .map((e): Command => ({ op: "disconnect", src: e.source, dst: e.target })),
    );
  };

  const addAtMenu = (kind: NodeKind) => {
    if (menu) addNodeAt(kind, screenToFlowPosition(menu));
    setMenu(null);
  };

  return (
    <div className="relative min-w-0 flex-1">
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-zinc-600">
          우클릭해서 노드를 놓거나 파일을 열어라 — examples/*.graph.json
        </div>
      )}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={(c: Connection) => run({ op: "connect", src: c.source, dst: c.target })}
        // 핀을 끌고 있는 동안 실시간 거부. command와 같은 규칙 + shape.
        isValidConnection={(c) => connectionError({ nodes, edges }, c.source, c.target) === null}
        onDelete={onDelete}
        deleteKeyCode={["Delete", "Backspace"]}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onPaneClick={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
      >
        <Background />
        <Controls />
      </ReactFlow>

      {menu && (
        <div
          className="fixed z-20 w-40 rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <NodeList onPick={addAtMenu} />
        </div>
      )}
    </div>
  );
}
