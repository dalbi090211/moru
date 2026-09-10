import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import Canvas from "./Canvas";
import { Inspector, NodeLibrary, Toolbar } from "./panels";
import { graphTemporal } from "./graph/graphStore";

/**
 * 셸. 캔버스와 패널이 전부 ReactFlowProvider 안에 있어야 한다 —
 * 툴바가 파일을 열고 나서 fitView를 부르고, 패널이 화면 좌표를 캔버스 좌표로 바꾼다.
 */
export default function App() {
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

  return (
    <ReactFlowProvider>
      <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100">
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <NodeLibrary />
          <Canvas />
          <Inspector />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
