import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_SPECS, type NodeData, type NodeKind } from "./specs";

/** 모든 노드가 쓰는 단 하나의 컴포넌트. spec을 읽어서 핀과 속성을 그린다. */
export default function BaseNode({ type, data, selected }: NodeProps) {
  const spec = NODE_SPECS[type as NodeKind];
  const { params = {}, shape, error } = data as NodeData;

  return (
    <div
      className={`min-w-40 rounded-md border bg-zinc-900 text-zinc-100 shadow-lg ${
        error ? "border-red-500" : selected ? "border-amber-400" : "border-zinc-700"
      }`}
    >
      {spec.inputs > 0 && <Handle type="target" position={Position.Top} className="!bg-zinc-400" />}

      <div className={`rounded-t px-3 py-1 text-xs font-semibold ${spec.accent}`}>{spec.label}</div>

      {Object.keys(spec.params).length > 0 && (
        <div className="px-3 py-1.5 text-[11px] font-mono">
          {Object.entries(spec.params).map(([key, p]) => (
            <div key={key} className="flex justify-between gap-3">
              <span className="text-zinc-400">{p.label}</span>
              <span>{JSON.stringify(params[key] ?? p.default)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 추론된 출력 shape. 핀 타입 시스템의 눈에 보이는 절반이다. */}
      <div className="border-t border-zinc-800 px-3 py-1 font-mono text-[10px]" title={error}>
        {error ? (
          <span className="line-clamp-2 text-red-400">{error}</span>
        ) : (
          <span className="text-zinc-500">{shape ? `[${shape.join(", ")}]` : "?"}</span>
        )}
      </div>

      {spec.outputs > 0 && (
        <Handle type="source" position={Position.Bottom} className="!bg-zinc-400" />
      )}
    </div>
  );
}
