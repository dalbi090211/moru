"""그래프 스키마. 타입의 단일 진실 공급원 (→ JSON Schema → types.gen.ts).

여기엔 '무엇이 있는가'만 둔다. shape 추론과 nn.Module 생성은 compile.py.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, model_validator

# ── 노드 ──────────────────────────────────────────────────────────────
# 모든 노드는 입력 0~1개, 출력 1개. 다입력(Add/Concat)이 생기면 그때 포트를 붙인다.


class NodeUI(BaseModel):
    """캔버스 위치. 백엔드는 읽지 않는다. 그래프 JSON이 곧 소스코드라
    레이아웃도 같이 저장해야 파일을 다시 열었을 때 화면이 안 흩어진다."""

    x: float
    y: float


class NodeBase(BaseModel):
    id: str
    ui: NodeUI | None = None


class InputNode(NodeBase):
    type: Literal["input"]
    shape: list[int]  # 배치 차원 제외. MNIST = [1, 28, 28]


class Conv2dNode(NodeBase):
    type: Literal["conv2d"]
    out_channels: int = Field(gt=0)
    kernel_size: int = Field(default=3, gt=0)
    stride: int = Field(default=1, gt=0)
    padding: int = Field(default=0, ge=0)


class LinearNode(NodeBase):
    type: Literal["linear"]
    out_features: int = Field(gt=0)


class ReLUNode(NodeBase):
    type: Literal["relu"]


class MaxPool2dNode(NodeBase):
    type: Literal["maxpool2d"]
    kernel_size: int = Field(default=2, gt=0)
    stride: int | None = None  # None이면 kernel_size와 동일 (PyTorch 규칙)


class FlattenNode(NodeBase):
    type: Literal["flatten"]


Node = Annotated[
    Union[InputNode, Conv2dNode, LinearNode, ReLUNode, MaxPool2dNode, FlattenNode],
    Field(discriminator="type"),
]


class Edge(BaseModel):
    src: str
    dst: str


# ── 학습 설정 ─────────────────────────────────────────────────────────
# 데이터/학습 노드는 빌드 순서 뒤쪽. 지금은 평범한 설정 블록으로 둔다.


class TrainConfig(BaseModel):
    dataset: Literal["mnist"] = "mnist"
    epochs: int = 1
    batch_size: int = 64
    lr: float = 1e-3


class Graph(BaseModel):
    nodes: list[Node]
    edges: list[Edge] = []
    train: TrainConfig = TrainConfig()

    @model_validator(mode="after")
    def _check_refs(self):
        ids = [n.id for n in self.nodes]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"중복 노드 id: {sorted(dupes)}")
        known = set(ids)
        for e in self.edges:
            missing = {e.src, e.dst} - known
            if missing:
                raise ValueError(f"엣지 {e.src}->{e.dst}: 없는 노드 {sorted(missing)}")
        return self

    def node(self, node_id: str) -> Node:
        return next(n for n in self.nodes if n.id == node_id)
