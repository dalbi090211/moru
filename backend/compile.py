"""그래프 -> nn.Module 컴파일러. 위상 정렬 + shape 추론이 여기 다 있다.

shape는 배치 차원을 뺀 튜플로 다룬다. [1,28,28] -> conv -> (16,26,26).
노드 타입 dispatch는 _build() 하나뿐이다. 모듈 생성과 출력 shape 계산을
같이 하므로 노드를 추가할 때 고칠 곳이 한 군데다.
"""

from __future__ import annotations

from itertools import pairwise
from math import prod

import torch
from torch import nn

from schema import (
    Conv2dNode,
    FlattenNode,
    Graph,
    InputNode,
    LinearNode,
    MaxPool2dNode,
    Node,
    ReLUNode,
)

Shape = tuple[int, ...]


class GraphError(Exception):
    """학습 시작 전에 잡히는 그래프 오류."""


# -- 위상 정렬 --------------------------------------------------------


def topo_order(g: Graph) -> tuple[list[str], dict[str, str | None]]:
    """(위상 순서, 노드id -> 선행 노드id). 사이클/다입력/고아를 여기서 거부."""
    pred: dict[str, str | None] = {n.id: None for n in g.nodes}
    succ: dict[str, list[str]] = {n.id: [] for n in g.nodes}
    for e in g.edges:
        if pred[e.dst] is not None:
            raise GraphError(
                f"'{e.dst}' 노드에 입력이 2개 이상이다 "
                f"('{pred[e.dst]}', '{e.src}'). 다입력 노드는 아직 없다."
            )
        pred[e.dst] = e.src
        succ[e.src].append(e.dst)

    inputs = [n.id for n in g.nodes if isinstance(n, InputNode)]
    if len(inputs) != 1:
        raise GraphError(f"input 노드는 정확히 1개여야 한다. 현재 {len(inputs)}개.")
    orphans = sorted({n.id for n in g.nodes if pred[n.id] is None} - set(inputs))
    if orphans:
        raise GraphError(f"입력이 없는 고아 노드: {orphans}")

    sinks = sorted(n.id for n in g.nodes if not succ[n.id])
    if len(sinks) != 1:
        raise GraphError(f"출력 노드는 정확히 1개여야 한다. 현재 {sinks}.")

    order: list[str] = []
    indeg = {n.id: (0 if pred[n.id] is None else 1) for n in g.nodes}
    stack = list(inputs)
    while stack:
        nid = stack.pop()
        order.append(nid)
        for nxt in succ[nid]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                stack.append(nxt)
    if len(order) != len(g.nodes):
        stuck = sorted(set(indeg) - set(order))
        raise GraphError(f"사이클이 있거나 도달할 수 없는 노드: {stuck}")
    return order, pred


# -- 노드 dispatch: (모듈, 출력 shape) --------------------------------


def _build(node: Node, in_shape: Shape | None) -> tuple[nn.Module | None, Shape]:
    def need(rank: int) -> Shape:
        if in_shape is None or len(in_shape) != rank:
            raise GraphError(
                f"'{node.id}'({node.type})는 {rank}D 입력이 필요한데 {in_shape}를 받았다."
            )
        return in_shape

    match node:
        case InputNode():
            if len(node.shape) not in (1, 3) or any(d <= 0 for d in node.shape):
                raise GraphError(f"'{node.id}' input shape이 이상하다: {node.shape}")
            return None, tuple(node.shape)

        case Conv2dNode():
            c, h, w = need(3)
            hw = _conv_hw(node.id, (h, w), node.kernel_size, node.stride, node.padding)
            m = nn.Conv2d(c, node.out_channels, node.kernel_size, node.stride, node.padding)
            return m, (node.out_channels, *hw)

        case MaxPool2dNode():
            c, h, w = need(3)
            stride = node.stride or node.kernel_size
            hw = _conv_hw(node.id, (h, w), node.kernel_size, stride, 0)
            return nn.MaxPool2d(node.kernel_size, stride), (c, *hw)

        case ReLUNode():
            if in_shape is None:
                raise GraphError(f"'{node.id}'에 입력이 없다.")
            return nn.ReLU(), in_shape

        case FlattenNode():
            if in_shape is None:
                raise GraphError(f"'{node.id}'에 입력이 없다.")
            return nn.Flatten(), (prod(in_shape),)

        case LinearNode():
            (features,) = need(1)
            return nn.Linear(features, node.out_features), (node.out_features,)

    raise GraphError(f"모르는 노드 타입: {node.type}")  # pragma: no cover


def _conv_hw(nid: str, hw: tuple[int, int], k: int, stride: int, pad: int) -> tuple[int, int]:
    out = tuple((d + 2 * pad - k) // stride + 1 for d in hw)
    if any(d < 1 for d in out):
        raise GraphError(
            f"'{nid}': 입력 {hw}에 kernel={k} stride={stride} padding={pad}를 적용하면 "
            f"출력이 {out}가 된다. 커널이 입력보다 크다."
        )
    return out


# -- 컴파일 -----------------------------------------------------------


class CompiledGraph(nn.Module):
    """위상 순서대로 노드를 실행한다. 중간 출력은 노드 id로 들고 있는다.

    지금은 노드마다 입력이 1개지만 이 루프는 다입력 노드가 생겨도 그대로 쓴다
    (src가 리스트가 되는 것뿐).
    """

    def __init__(self, plan: list[tuple[str, str | None, int | None]], mods: list[nn.Module]):
        super().__init__()
        self.plan = plan
        self.mods = nn.ModuleList(mods)
        self.output_id = plan[-1][0]

    def forward(self, x):
        vals: dict[str, torch.Tensor] = {}
        for nid, src, idx in self.plan:
            v = x if src is None else vals[src]
            vals[nid] = v if idx is None else self.mods[idx](v)
        return vals[self.output_id]


def compile_graph(g: Graph) -> tuple[CompiledGraph, dict[str, Shape]]:
    """검증 + 컴파일. 실패하면 GraphError. 반환: (모델, 노드별 출력 shape)."""
    order, pred = topo_order(g)
    shapes: dict[str, Shape] = {}
    plan: list[tuple[str, str | None, int | None]] = []
    mods: list[nn.Module] = []
    for nid in order:
        src = pred[nid]
        mod, out = _build(g.node(nid), shapes[src] if src else None)
        shapes[nid] = out
        plan.append((nid, src, None if mod is None else len(mods)))
        if mod is not None:
            mods.append(mod)
    return CompiledGraph(plan, mods), shapes


# -- 학습 설정 --------------------------------------------------------
# 나중에 Loss/Optimizer/Dataset 노드로 옮겨갈 자리.
# graph.train을 읽는 코드는 전부 이 아래에만 둔다.

DATASETS = {"mnist": {"input_shape": (1, 28, 28), "classes": 10}}


def build_training(g: Graph, model: CompiledGraph, shapes: dict[str, Shape]):
    """(loss_fn, optimizer, cfg). 데이터셋과 그래프 입출력이 맞는지도 여기서 본다."""
    cfg = g.train
    spec = DATASETS[cfg.dataset]

    in_node = next(n for n in g.nodes if isinstance(n, InputNode))
    if tuple(in_node.shape) != spec["input_shape"]:
        raise GraphError(
            f"input shape {tuple(in_node.shape)}이 {cfg.dataset}의 "
            f"{spec['input_shape']}와 다르다."
        )
    out_shape = shapes[model.output_id]
    if out_shape != (spec["classes"],):
        raise GraphError(
            f"출력 shape {out_shape}이 {cfg.dataset} 분류에 맞지 않다. "
            f"({spec['classes']},)이어야 한다."
        )
    return nn.CrossEntropyLoss(), torch.optim.Adam(model.parameters(), lr=cfg.lr), cfg


# -- 자체 점검 --------------------------------------------------------

if __name__ == "__main__":
    IN = {"id": "in", "type": "input", "shape": [1, 28, 28]}

    def graph(nodes, edges):
        return Graph.model_validate({"nodes": nodes, "edges": edges})

    def chain(*nodes):
        return graph(list(nodes), [{"src": a["id"], "dst": b["id"]} for a, b in pairwise(nodes)])

    def rejects(fragment, g):
        try:
            model, shapes = compile_graph(g)
            build_training(g, model, shapes)
        except GraphError as e:
            assert fragment in str(e), f"기대 {fragment!r}, 실제: {e}"
        else:
            raise AssertionError(f"거부됐어야 한다: {fragment}")

    # conv/pool shape 계산이 실제 PyTorch와 맞는지
    g = chain(
        IN,
        {"id": "c1", "type": "conv2d", "out_channels": 8, "kernel_size": 5, "padding": 2},
        {"id": "r1", "type": "relu"},
        {"id": "p1", "type": "maxpool2d", "kernel_size": 2},
        {"id": "fl", "type": "flatten"},
        {"id": "fc", "type": "linear", "out_features": 10},
    )
    model, shapes = compile_graph(g)
    assert shapes["c1"] == (8, 28, 28), shapes
    assert shapes["p1"] == (8, 14, 14), shapes
    assert shapes["fl"] == (8 * 14 * 14,), shapes
    assert model(torch.zeros(2, 1, 28, 28)).shape == (2, 10)
    build_training(g, model, shapes)

    # 위상 정렬이 실제로 순서를 잡는지 (엣지를 거꾸로 나열해도 동작)
    nodes = [IN, {"id": "fl", "type": "flatten"}, {"id": "fc", "type": "linear", "out_features": 10}]
    shuffled = graph(nodes, [{"src": "fl", "dst": "fc"}, {"src": "in", "dst": "fl"}])
    m2, _ = compile_graph(shuffled)
    assert [p[0] for p in m2.plan] == ["in", "fl", "fc"]

    rejects("1D 입력", chain(IN, {"id": "fc", "type": "linear", "out_features": 10}))
    rejects("커널이 입력보다", chain(IN, {"id": "c", "type": "conv2d", "out_channels": 4, "kernel_size": 29}))
    rejects("3D 입력", chain(
        {"id": "in", "type": "input", "shape": [784]},
        {"id": "c", "type": "conv2d", "out_channels": 4},
    ))
    rejects("사이클", graph(
        [IN, {"id": "a", "type": "relu"}, {"id": "b", "type": "relu"}, {"id": "c", "type": "relu"}],
        [{"src": "in", "dst": "c"}, {"src": "a", "dst": "b"}, {"src": "b", "dst": "a"}],
    ))
    rejects("고아", graph([IN, {"id": "a", "type": "relu"}], []))
    rejects("출력 노드는", graph(
        [IN, {"id": "a", "type": "relu"}, {"id": "b", "type": "relu"}],
        [{"src": "in", "dst": "a"}, {"src": "in", "dst": "b"}],
    ))
    rejects("입력이 2개", graph(
        [IN, {"id": "a", "type": "relu"}, {"id": "b", "type": "relu"}],
        [{"src": "in", "dst": "a"}, {"src": "in", "dst": "b"}, {"src": "a", "dst": "b"}],
    ))
    rejects("input 노드는", chain({"id": "a", "type": "relu"}, {"id": "b", "type": "relu"}))
    # 데이터셋과 출력 클래스 수 불일치
    rejects("분류에 맞지 않", chain(
        IN, {"id": "fl", "type": "flatten"}, {"id": "fc", "type": "linear", "out_features": 7},
    ))
    # 데이터셋과 입력 shape 불일치
    rejects("와 다르다", chain(
        {"id": "in", "type": "input", "shape": [3, 32, 32]},
        {"id": "fl", "type": "flatten"},
        {"id": "fc", "type": "linear", "out_features": 10},
    ))


    # examples/shape_cases.json — frontend/src/graph/shapes.ts와 공유하는 대조표.
    # shape 공식은 클라이언트에도 있다(즉각 피드백). 한쪽만 고치면 캔버스에서는
    # 연결되는데 학습이 터지므로, 같은 파일을 양쪽 테스트가 함께 돌린다.
    import json
    from pathlib import Path

    fixture = Path(__file__).resolve().parent.parent / "examples" / "shape_cases.json"
    cases = json.loads(fixture.read_text(encoding="utf-8"))["cases"]
    assert len(cases) > 5, "대조표가 비었나?"
    for case in cases:
        g = chain(*case["chain"])
        if "error" in case:
            rejects(f"'{case['error']}'", g)
            continue
        model, shapes = compile_graph(g)
        for nid, want in case["shapes"].items():
            assert shapes[nid] == tuple(want), (case["name"], nid, shapes[nid], want)
        # 공식끼리 맞추는 데서 끝내지 않고 실제 PyTorch 출력과도 맞춰본다
        out = model(torch.zeros(2, *shapes[g.nodes[0].id]))
        assert tuple(out.shape[1:]) == shapes[model.output_id], (case["name"], out.shape)
    print(f"shape_cases.json {len(cases)}건 대조 OK")
    print("compile.py self-check OK")
