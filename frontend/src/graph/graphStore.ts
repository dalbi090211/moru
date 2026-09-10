import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import { create } from "zustand";
import { shallow } from "zustand/shallow";
import { applyCommand, type Command, type GraphState } from "./commands.ts";
import type { Graph } from "../types.gen.ts";
import { autoLayout } from "./layout.ts";

/**
 * 그래프 상태. undo 대상은 이 스토어뿐이다.
 * 채팅(sessionStore), 학습 metric(runStore), 레이아웃(uiStore)은 따로 둔다.
 * 여기 섞으면 Ctrl+Z에 대화가 되감긴다.
 */

type GraphStore = GraphState & {
  /** UI에 편집기가 아직 없는 학습 설정. 파일에서 온 값을 저장할 때 그대로 돌려준다. */
  train: Graph["train"];
  /** 편집하는 유일한 경로. 여러 개를 넘기면 undo 한 번에 통째로 되돌아간다. */
  apply: (...cmds: Command[]) => void;
};

export const useGraphStore = create<GraphStore>()(
  temporal(
    immer((set) => ({
      nodes: [],
      edges: [],
      train: undefined,
      apply: (...cmds) =>
        set((draft) => {
          for (const cmd of cmds) applyCommand(draft, cmd);
        }),
    })),
    {
      // 파생값(shape 등)은 히스토리에 넣지 않는다. 지금은 nodes/edges가 전부다.
      partialize: ({ nodes, edges }) => ({ nodes, edges }),
      // nodes/edges 참조가 그대로면 히스토리에 안 넣는다. partialize가 매번 새 객체를
      // 만들기 때문에 이게 없으면 train 같은 비-그래프 필드 변경까지 undo 한 칸을 먹는다.
      equality: shallow,
      // ponytail: handleSet debounce 없음. 드래그는 onNodeDragStop에서 move_node를 한 번만
      // 보내서 막는다. 매 프레임 move_node가 스토어로 들어오기 시작하면 그때 넣는다.
      limit: 100,
    },
  ),
);

export const graphTemporal = useGraphStore.temporal.getState;

/**
 * 파일에서 읽은 그래프로 통째로 갈아끼운다. 여기도 command를 거치므로 모르는 노드 타입,
 * 없는 노드를 가리키는 엣지, 사이클은 그대로 튕기고 스토어는 손도 안 탄다. undo 한 칸.
 * ponytail: 파라미터 값까지는 검증 안 한다. 학습 시작할 때 pydantic이 잡는다.
 */
export function loadGraph(g: Graph): void {
  const { nodes, apply } = useGraphStore.getState();
  // 좌표 없는 노드는 여기서 자리를 받는다. 안 하면 전부 (0,0)에 겹쳐서 뭉친다.
  const placed = autoLayout({ nodes: g.nodes, edges: g.edges ?? [] });
  apply(
    { op: "delete", ids: nodes.map((n) => n.id) },
    ...placed.map((node): Command => ({ op: "add_node", node })),
    ...(g.edges ?? []).map(({ src, dst }): Command => ({ op: "connect", src, dst })),
  );
  useGraphStore.setState({ train: g.train });
}

/** 저장용 스냅샷. 그래프 JSON이 이 프로젝트의 실제 소스코드다. */
export const toGraph = (): Graph => {
  const { nodes, edges, train } = useGraphStore.getState();
  return { nodes, edges, train };
};
