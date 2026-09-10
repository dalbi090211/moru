/** node --experimental-strip-types (npm run check). 프레임워크 없음. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectionError, inferShapes, ShapeError, outputShape } from "./shapes.ts";
import type { GraphNode, GraphState } from "./commands.ts";

/**
 * backend/compile.py와 공유하는 대조표를 돌린다. 같은 파일을 compile.py의
 * 자체 점검도 돌리므로, 공식을 한쪽만 고치면 그쪽 테스트가 깨진다.
 */
type Case = {
  name: string;
  chain: GraphNode[];
  shapes?: Record<string, number[]>;
  error?: string;
};

const fixture = new URL("../../../examples/shape_cases.json", import.meta.url);
const { cases } = JSON.parse(readFileSync(fixture, "utf8")) as { cases: Case[] };
assert.ok(cases.length > 5, "대조표가 비었나?");

for (const c of cases) {
  const g: GraphState = {
    nodes: c.chain,
    edges: c.chain.slice(1).map((n, i) => ({ src: c.chain[i].id, dst: n.id })),
  };
  const { shapes, errors } = inferShapes(g);

  if (c.error) {
    const msg = errors.get(c.error);
    assert.ok(msg, `${c.name}: '${c.error}'에서 거부됐어야 하는데 통과했다`);
    assert.ok(msg.includes(`'${c.error}'`), `${c.name}: 에러가 어느 노드인지 말해야 한다`);
    // 거부된 노드 뒤로는 shape을 아는 척하지 않는다
    for (const after of c.chain.slice(c.chain.findIndex((n) => n.id === c.error)))
      assert.ok(!shapes.has(after.id), `${c.name}: '${after.id}'의 shape을 알 수 없다`);
  } else {
    assert.deepEqual([...errors], [], `${c.name}: 에러가 없어야 한다`);
    for (const [id, want] of Object.entries(c.shapes ?? {}))
      assert.deepEqual(shapes.get(id), want, `${c.name}: '${id}'`);
  }
}

// ── isValidConnection이 command와 같은 규칙 + shape을 보는가 ──
const node = (id: string, type: string, extra: object = {}) =>
  ({ id, type, ...extra }) as GraphNode;

const g: GraphState = {
  nodes: [
    node("in", "input", { shape: [1, 28, 28] }),
    node("fl", "flatten"),
    node("fc", "linear", { out_features: 10 }),
    node("c1", "conv2d", { out_channels: 8 }),
  ],
  edges: [{ src: "in", dst: "fl" }],
};

assert.equal(connectionError(g, "fl", "fc"), null, "784 -> linear는 된다");
assert.equal(connectionError(g, "in", "c1"), null, "3D -> conv는 된다");
assert.match(connectionError(g, "in", "fc") ?? "", /1D 입력/, "3D를 linear에 꽂으면 안 된다");
assert.match(connectionError(g, "fl", "c1") ?? "", /3D 입력/, "1D를 conv에 꽂으면 안 된다");
// 구조 규칙도 그대로 산다
assert.match(connectionError(g, "in", "fl") ?? "", /이미 입력이 있다/);
assert.match(connectionError(g, "fl", "in") ?? "", /사이클/);
assert.match(connectionError(g, "in", "in") ?? "", /자기 자신/);
// 상류 shape을 모르면 막지 않는다 (편집 중에는 늘 덜 연결돼 있다)
assert.equal(connectionError({ nodes: g.nodes, edges: [] }, "fl", "fc"), null);

// flatten은 1D도 그대로 통과시킨다 (compile.py의 prod와 같음)
assert.deepEqual(outputShape(node("fl", "flatten"), [784]), [784]);
assert.throws(() => outputShape(node("fl", "flatten"), null), ShapeError);

console.log("shapes.check.ts OK");
