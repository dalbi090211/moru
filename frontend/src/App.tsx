import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import BaseNode from "./nodes/BaseNode";
import { NODE_SPECS, defaultParams, type NodeKind } from "./nodes/specs";

// spec 하나당 컴포넌트 하나를 손으로 등록하지 않는다. 전부 BaseNode로 보낸다.
const nodeTypes = Object.fromEntries(Object.keys(NODE_SPECS).map((k) => [k, BaseNode]));

const node = (id: string, kind: NodeKind, x: number, y: number): Node => ({
  id,
  type: kind,
  position: { x, y },
  data: { params: defaultParams(kind) },
});

// ponytail: 초기 그래프 하드코딩 + useNodesState. 3번(graphStore + command)에서 갈아낀다.
// 지금 노드 추가 UI를 붙이면 command를 거치지 않는 편집 경로가 생긴다.
const initialNodes: Node[] = [
  node("input", "input", 0, 0),
  node("fc1", "linear", 0, 130),
  node("relu1", "relu", 0, 260),
];
const initialEdges: Edge[] = [
  { id: "e1", source: "input", target: "fc1" },
  { id: "e2", source: "fc1", target: "relu1" },
];

export default function App() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-screen w-screen bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
