/** node --experimental-strip-types (npm run check). 프레임워크 없음. */
import assert from "node:assert/strict";
import { produce } from "immer";
import { applyCommand, CommandError, type Command, type GraphState } from "./commands.ts";
import { useGraphStore } from "./graphStore.ts";

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
rejects("모르는 노드 타입", { op: "add_node", node: node("c", "conv2d", { out_channels: 8 }) });

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

console.log("commands.check.ts OK");
