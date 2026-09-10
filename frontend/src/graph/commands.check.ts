/** node --experimental-strip-types (npm run check). 프레임워크 없음. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { produce } from "immer";
import { applyCommand, CommandError, type Command, type GraphState } from "./commands.ts";
import { loadGraph, toGraph, useGraphStore } from "./graphStore.ts";
import { syncRFNodes } from "./rf.ts";

const node = (id: string, type: string, extra: object = {}) =>
  ({ id, type, ...extra }) as GraphState["nodes"][number];

const IN = node("in", "input", { shape: [1, 28, 28] });
const FC = node("fc", "linear", { out_features: 128 });
const RELU = node("relu", "relu");

const run = (g: GraphState, ...cmds: Command[]): GraphState =>
  produce(g, (d) => {
    for (const c of cmds) applyCommand(d, c);
  });

const empty: GraphState = { nodes: [], edges: [] };
const chain = run(
  empty,
  { op: "add_node", node: IN },
  { op: "add_node", node: RELU },
  { op: "connect", src: "in", dst: "relu" },
);
assert.deepEqual(chain.edges, [{ src: "in", dst: "relu" }]);
assert.equal(empty.nodes.length, 0, "원본이 변하면 안 된다");

const rejects = (fragment: string, ...cmds: Command[]) => {
  assert.throws(
    () => run(chain, ...cmds),
    (e: Error) => e instanceof CommandError && e.message.includes(fragment),
    `거부됐어야 한다: ${fragment}`,
  );
};

rejects("이미 있는 노드 id", { op: "add_node", node: IN });
rejects("없는 노드", { op: "connect", src: "in", dst: "없음" });
rejects("자기 자신", { op: "connect", src: "in", dst: "in" });
rejects("이미 입력이 있다", { op: "add_node", node: FC }, { op: "connect", src: "fc", dst: "relu" });
rejects("사이클", { op: "connect", src: "relu", dst: "in" });
rejects("없는 파라미터", { op: "set_param", id: "relu", key: "out_features", value: 4 });
rejects("모르는 노드 타입", { op: "add_node", node: node("bn", "batchnorm") }); // NODE_SPECS에 없다

// insert_nodes: in -> relu 사이에 linear가 끼어든다
const inserted = run(chain, { op: "insert_nodes", after: "in", nodes: [FC] });
assert.deepEqual(inserted.edges, [
  { src: "in", dst: "fc" },
  { src: "fc", dst: "relu" },
]);
// 꼬리가 없으면 그냥 이어붙인다
assert.deepEqual(run(inserted, { op: "insert_nodes", after: "relu", nodes: [node("fc2", "linear", { out_features: 10 })] }).edges.at(-1), {
  src: "relu",
  dst: "fc2",
});

// delete는 딸린 엣지까지 지운다
const deleted = run(inserted, { op: "delete", ids: ["fc"] });
assert.deepEqual(deleted.nodes.map((n) => n.id), ["in", "relu"]);
assert.deepEqual(deleted.edges, []);

// set_param / move_node
const moved = run(chain, { op: "move_node", id: "in", x: 10, y: 20 });
assert.deepEqual(moved.nodes[0].ui, { x: 10, y: 20 });
const repar = run(inserted, { op: "set_param", id: "fc", key: "out_features", value: 64 });
assert.equal((repar.nodes.find((n) => n.id === "fc") as { out_features: number }).out_features, 64);

// 트랜잭션: 하나라도 실패하면 전부 안 들어간다
assert.throws(() =>
  run(chain, { op: "add_node", node: FC }, { op: "connect", src: "fc", dst: "없음" }),
);
assert.equal(chain.nodes.length, 2);

// ── 스토어 + zundo: 묶어서 보낸 command는 Ctrl+Z 한 번에 되돌아간다 ──
const { apply } = useGraphStore.getState();
const temporal = useGraphStore.temporal.getState;

apply({ op: "add_node", node: IN });
apply(
  { op: "add_node", node: FC },
  { op: "connect", src: "in", dst: "fc" },
  { op: "add_node", node: RELU },
  { op: "connect", src: "fc", dst: "relu" },
);
assert.equal(useGraphStore.getState().nodes.length, 3);
assert.equal(temporal().pastStates.length, 2, "set 한 번 = 히스토리 한 칸");

temporal().undo();
assert.deepEqual(useGraphStore.getState().nodes.map((n) => n.id), ["in"], "3개가 한 번에 사라져야 한다");
temporal().redo();
assert.equal(useGraphStore.getState().edges.length, 2);

// ── 파일 로드/저장: 실제 예제 그래프가 UI 스토어에 들어가는가 ──
const cnn = JSON.parse(
  readFileSync(new URL("../../../examples/mnist_cnn.graph.json", import.meta.url), "utf8"),
);
loadGraph(cnn);
assert.deepEqual(
  toGraph().nodes.map((n) => n.id),
  ["input", "conv1", "relu1", "pool1", "flatten", "fc1"],
);
assert.equal(toGraph().edges?.length, 5);
assert.equal(toGraph().train?.batch_size, 64, "UI가 안 건드리는 train 설정도 그대로 나가야 한다");
assert.deepEqual(JSON.parse(JSON.stringify(toGraph())), cnn, "열고 바로 저장하면 원본 그대로");

temporal().undo();
assert.equal(useGraphStore.getState().nodes.length, 3, "로드도 undo 한 칸");
temporal().redo();

// 실패한 로드는 스토어를 건드리지 않는다
const before = useGraphStore.getState().nodes.length;
assert.throws(() => loadGraph({ nodes: [node("bn", "batchnorm")] }), CommandError);
assert.equal(useGraphStore.getState().nodes.length, before);

// ── 변환 계층: RF가 붙여둔 실측값을 물려주는가 ──
// 안 물려주면 RF가 노드를 visibility:hidden으로 그리고 다시 잰다 = 드래그 중 깜빡임.
const IN2 = node("in", "input", { shape: [1, 28, 28], ui: { x: 5, y: 6 } });
const measured = { width: 160, height: 44 };
const live = syncRFNodes([], { nodes: [IN], edges: [] }).map((n) => ({ ...n, measured, selected: true }));
const [synced] = syncRFNodes(live, { nodes: [IN2], edges: [] });
assert.deepEqual(synced.measured, measured, "실측값을 잃으면 노드가 숨는다");
assert.equal(synced.selected, true, "선택 상태도 캔버스 쪽 것이다");
assert.deepEqual(synced.position, { x: 5, y: 6 }, "위치는 스토어가 이긴다");
const data = synced.data as { params: object; shape?: number[] };
assert.deepEqual(data.params, { shape: [1, 28, 28] }, "파라미터만 감싼다 (ui/id/type 제외)");
assert.deepEqual(data.shape, [1, 28, 28], "추론한 출력 shape도 같이 실린다");
assert.deepEqual(syncRFNodes(live, empty), [], "스토어에서 사라진 노드는 캔버스에서도 사라진다");

console.log("commands.check.ts OK");
