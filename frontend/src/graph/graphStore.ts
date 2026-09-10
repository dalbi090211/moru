import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import { create } from "zustand";
import { applyCommand, type Command, type GraphState } from "./commands.ts";

/**
 * 그래프 상태. undo 대상은 이 스토어뿐이다.
 * 채팅(sessionStore), 학습 metric(runStore), 레이아웃(uiStore)은 따로 둔다.
 * 여기 섞으면 Ctrl+Z에 대화가 되감긴다.
 */

type GraphStore = GraphState & {
  /** 편집하는 유일한 경로. 여러 개를 넘기면 undo 한 번에 통째로 되돌아간다. */
  apply: (...cmds: Command[]) => void;
};

export const useGraphStore = create<GraphStore>()(
  temporal(
    immer((set) => ({
      nodes: [],
      edges: [],
      apply: (...cmds) =>
        set((draft) => {
          for (const cmd of cmds) applyCommand(draft, cmd);
        }),
    })),
    {
      // 파생값(shape 등)은 히스토리에 넣지 않는다. 지금은 nodes/edges가 전부다.
      partialize: ({ nodes, edges }) => ({ nodes, edges }),
      // ponytail: handleSet debounce 없음. 드래그는 onNodeDragStop에서 move_node를 한 번만
      // 보내서 막는다. 매 프레임 move_node가 스토어로 들어오기 시작하면 그때 넣는다.
      limit: 100,
    },
  ),
);

export const graphTemporal = useGraphStore.temporal.getState;
