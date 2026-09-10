import { useEffect, useState, type ChangeEvent } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";
import BaseNode from "./nodes/BaseNode";
import { NODE_SPECS } from "./nodes/specs";
import { CommandError, type Command } from "./graph/commands";
import { graphTemporal, loadGraph, toGraph, useGraphStore } from "./graph/graphStore";
import { syncRFNodes, toRFEdge } from "./graph/rf";

// spec 하나당 컴포넌트 하나를 손으로 등록하지 않는다. 전부 BaseNode로 보낸다.
const nodeTypes = Object.fromEntries(Object.keys(NODE_SPECS).map((k) => [k, BaseNode]));

export default function App() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const apply = useGraphStore((s) => s.apply);

  // 캔버스가 들고 있는 사본. 그래프 편집은 여전히 command로만 간다 — 여기 사는 건
  // 선택, 실측 크기, 드래그 중 위치처럼 RF가 프레임 단위로 만지는 것들뿐이다.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  useEffect(() => setRfNodes((prev) => syncRFNodes(prev, nodes)), [nodes, setRfNodes]);
  useEffect(() => setRfEdges(edges.map(toRFEdge)), [edges, setRfEdges]);

  const [error, setError] = useState("");

  /** command를 거부당하면(사이클, 다중입력 등) 죽지 말고 이유를 보여준다. */
  const run = (...cmds: Command[]) => {
    try {
      apply(...cmds);
      setError("");
    } catch (e) {
      setError(e instanceof CommandError ? e.message : String(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) graphTemporal().redo();
      else graphTemporal().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 드래그 중에는 RF가 사본만 움직인다. 스토어에는 놓을 때 한 번,
  // 같이 끌린 노드까지 한 트랜잭션으로 간다 (Ctrl+Z 한 번에 전부 제자리).
  const onNodeDragStop = (_e: unknown, _n: RFNode, dragged: RFNode[]) =>
    run(...dragged.map((n): Command => ({ op: "move_node", id: n.id, ...n.position })));

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

  const onOpen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 열 수 있게
    if (!file) return;
    try {
      loadGraph(JSON.parse(await file.text()));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ponytail: 브라우저 다운로드. Tauri 셸이 붙으면 파일 다이얼로그로 갈아낀다.
  const onSave = () => {
    const json = JSON.stringify(toGraph(), null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = "graph.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const btn = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 hover:bg-zinc-800";

  return (
    <div className="relative h-screen w-screen bg-zinc-950">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2 text-xs text-zinc-100">
        <label className={`${btn} cursor-pointer`}>
          열기
          <input type="file" accept=".json" className="hidden" onChange={onOpen} />
        </label>
        <button className={btn} onClick={onSave}>
          저장
        </button>
        <button className={btn} onClick={() => graphTemporal().undo()}>
          Undo
        </button>
        <button className={btn} onClick={() => graphTemporal().redo()}>
          Redo
        </button>
        {error && <span className="text-red-400">{error}</span>}
      </div>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-zinc-600">
          그래프를 열어라 — examples/*.graph.json
        </div>
      )}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={(c: Connection) => run({ op: "connect", src: c.source, dst: c.target })}
        onDelete={onDelete}
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
