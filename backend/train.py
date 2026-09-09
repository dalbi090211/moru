"""python train.py <graph.json> - 그래프를 컴파일해서 학습시킨다.

FastAPI도 UI도 없는 단계. 컴파일러가 도는지 확인하는 용도.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch
from pydantic import ValidationError
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

from compile import GraphError, build_training, compile_graph
from schema import Graph

DATA_ROOT = Path(__file__).resolve().parent.parent / "data"


def load_mnist(batch_size: int) -> tuple[DataLoader, DataLoader]:
    tf = transforms.Compose(
        [transforms.ToTensor(), transforms.Normalize((0.1307,), (0.3081,))]
    )
    kw = dict(root=DATA_ROOT, download=True, transform=tf)
    # ponytail: num_workers=0. Windows에서 spawn 비용이 CPU MNIST 이득보다 크다.
    return (
        DataLoader(datasets.MNIST(train=True, **kw), batch_size=batch_size, shuffle=True),
        DataLoader(datasets.MNIST(train=False, **kw), batch_size=512),
    )


@torch.no_grad()
def accuracy(model, loader, device) -> float:
    model.eval()
    correct = total = 0
    for x, y in loader:
        pred = model(x.to(device)).argmax(1).cpu()
        correct += (pred == y).sum().item()
        total += len(y)
    model.train()
    return correct / total


def main() -> int:
    ap = argparse.ArgumentParser(description="그래프 JSON을 컴파일해서 학습")
    ap.add_argument("graph", type=Path)
    ap.add_argument("--check", action="store_true", help="컴파일과 shape 추론만 하고 끝")
    args = ap.parse_args()

    try:
        g = Graph.model_validate_json(args.graph.read_text(encoding="utf-8"))
        model, shapes = compile_graph(g)
        loss_fn, optimizer, cfg = build_training(g, model, shapes)
    except (GraphError, ValidationError) as e:
        print(f"그래프 오류:\n{e}", file=sys.stderr)
        return 1

    for nid, _, _ in model.plan:
        node = g.node(nid)
        print(f"  {nid:<12} {node.type:<10} -> {tuple(shapes[nid])}")
    params = sum(p.numel() for p in model.parameters())
    print(f"  파라미터 {params:,}개")
    if args.check:
        return 0

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    train_loader, test_loader = load_mnist(cfg.batch_size)
    print(f"{cfg.dataset} / {device} / epochs={cfg.epochs} batch={cfg.batch_size} lr={cfg.lr}")

    for epoch in range(cfg.epochs):
        running = 0.0
        for i, (x, y) in enumerate(train_loader, 1):
            x, y = x.to(device), y.to(device)
            optimizer.zero_grad()
            loss = loss_fn(model(x), y)
            loss.backward()
            optimizer.step()
            running += loss.item()
            if i % 100 == 0:
                print(f"  epoch {epoch + 1} [{i}/{len(train_loader)}] loss {running / 100:.4f}")
                running = 0.0
        print(f"epoch {epoch + 1} 끝. test accuracy {accuracy(model, test_loader, device):.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
