import { useReactFlow, useStore } from "@xyflow/react";
import { shallow } from "zustand/shallow";
import type { ChangeEvent } from "react";
import { NODE_SPECS, formatParam as format, parseParam, type NodeKind, type ParamSpec } from "./nodes/specs";
import { addNodeAt, graphTemporal, loadGraph, setError, toGraph, useGraphStore } from "./graph/graphStore";

/**
 * 패널은 전부 NODE_SPECS에서 나온다. 노드를 추가하려면 spec에 한 줄 넣으면 되고
 * 라이브러리 목록과 Inspector 폼이 같이 따라온다.
 * ponytail: 그냥 flex 3단. dockview는 6번에서.
 */

const BTN = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 hover:bg-zinc-800";

/** 노드 목록. 라이브러리 패널과 우클릭 메뉴가 같은 걸 그린다. */
export function NodeList({ onPick }: { onPick: (kind: NodeKind) => void }) {
  return (
    <>
      {Object.entries(NODE_SPECS).map(([kind, spec]) => (
        <button
          key={kind}
          onClick={() => onPick(kind as NodeKind)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-zinc-800"
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${spec.accent}`} />
          {spec.label}
        </button>
      ))}
    </>
  );
}

export function NodeLibrary() {
  const { screenToFlowPosition } = useReactFlow();
  // 패널에서 누르면 화면 한가운데. 자리를 고르고 싶으면 캔버스 우클릭.
  const addToCenter = (kind: NodeKind) =>
    addNodeAt(kind, screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));

  return (
    <aside className="w-44 shrink-0 overflow-y-auto border-r border-zinc-800 p-2">
      <div className="mb-1 px-2 text-[10px] tracking-wider text-zinc-500 uppercase">노드</div>
      <NodeList onPick={addToCenter} />
    </aside>
  );
}

export function Toolbar() {
  const error = useGraphStore((s) => s.error);
  const { fitView } = useReactFlow();

  const onOpen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 열 수 있게
    if (!file) return;
    try {
      loadGraph(JSON.parse(await file.text()));
      setError(null);
      await fitView(); // 노드가 실측될 때까지 RF가 알아서 기다린다
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

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 p-2 text-xs">
      <label className={`${BTN} cursor-pointer`}>
        열기
        <input type="file" accept=".json" className="hidden" onChange={onOpen} />
      </label>
      <button className={BTN} onClick={onSave}>
        저장
      </button>
      <button className={BTN} onClick={() => graphTemporal().undo()}>
        Undo
      </button>
      <button className={BTN} onClick={() => graphTemporal().redo()}>
        Redo
      </button>
      {error && <span className="truncate text-red-400">{error}</span>}
    </div>
  );
}

function ParamField({ id, name, spec, value }: {
  id: string;
  name: string;
  spec: ParamSpec;
  value: unknown;
}) {
  const run = useGraphStore((s) => s.run);

  const commit = (input: HTMLInputElement) => {
    const parsed = parseParam(spec, input.value);
    if (parsed === undefined) {
      input.value = format(value); // 못 읽은 입력은 되돌린다
      setError(`'${spec.label}'에 넣을 수 없는 값이다.`);
      return;
    }
    run({ op: "set_param", id, key: name, value: parsed });
  };

  return (
    <label className="mb-2 block">
      <span className="mb-0.5 block text-[10px] text-zinc-500">{spec.label}</span>
      <input
        // 스토어 값이 밖에서 바뀌면(undo 등) key가 바뀌며 새로 그려진다.
        key={format(value)}
        defaultValue={format(value)}
        placeholder={spec.kind === "shape" ? "1, 28, 28" : String(spec.default ?? "기본값")}
        onBlur={(e) => commit(e.target)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs outline-none focus:border-amber-400"
      />
    </label>
  );
}

export function Inspector() {
  // 선택은 RF가 들고 있다. 우리가 또 들면 두 벌이 어긋난다.
  const selected = useStore((s) => s.nodes.filter((n) => n.selected).map((n) => n.id), shallow);
  const node = useGraphStore((s) =>
    selected.length === 1 ? s.nodes.find((n) => n.id === selected[0]) : undefined,
  );

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-zinc-800 p-3">
      {!node ? (
        <p className="text-xs text-zinc-600">
          {selected.length > 1 ? `${selected.length}개 선택됨` : "노드를 선택하면 여기서 고친다"}
        </p>
      ) : (
        <>
          <div className="mb-3">
            <div className="text-sm font-semibold">{NODE_SPECS[node.type as NodeKind].label}</div>
            <div className="font-mono text-[10px] text-zinc-500">{node.id}</div>
          </div>
          {Object.entries(NODE_SPECS[node.type as NodeKind].params).map(([name, spec]) => (
            <ParamField
              key={name}
              id={node.id}
              name={name}
              spec={spec}
              value={(node as unknown as Record<string, unknown>)[name]}
            />
          ))}
          {Object.keys(NODE_SPECS[node.type as NodeKind].params).length === 0 && (
            <p className="text-xs text-zinc-600">고칠 파라미터가 없다.</p>
          )}
        </>
      )}
    </aside>
  );
}
