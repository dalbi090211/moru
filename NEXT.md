# 현재 상태

마지막 커밋 `82519c0`. 빌드 순서 **1~6번 완료**, 다음은 **7번 (WS + 학습 metric 스트리밍)**.

```bash
cd frontend && npm run build && npm run check && npm run lint
cd backend  && uv run python compile.py          # 자체 점검 + shape 대조표
cd backend  && uv run python train.py ../examples/mnist_cnn.graph.json --check
```

전부 초록인 상태에서 시작할 것.

---

## 완료된 것

| # | 항목 | 어디 |
|---|---|---|
| 1 | pydantic 스키마 → `nn.Module` 컴파일러, MNIST 학습 | `backend/schema.py`, `compile.py`, `train.py` |
| 2 | `NODE_SPECS` + `BaseNode` + 캔버스 | `frontend/src/nodes/`, `Canvas.tsx` |
| 3 | `graphStore` + command + zundo | `frontend/src/graph/commands.ts`, `graphStore.ts` |
| 4 | shape 추론 + `isValidConnection` | `frontend/src/graph/shapes.ts` |
| 5 | Inspector (spec에서 폼 자동 생성) | `frontend/src/panels.tsx` |
| 6 | 패널 레이아웃 | `App.tsx` — **flex 3단. dockview 아님** |

노드 6종: input, conv2d, relu, maxpool2d, flatten, linear.
`examples/mnist_mlp.graph.json`, `mnist_cnn.graph.json` 둘 다 UI에서 열리고 학습도 된다.

### 6번은 축소판이다

dockview/react-mosaic 없이 그냥 flex 3단(라이브러리 · 캔버스 · Inspector)이다.
패널을 떼어내거나 재배치할 수 없다. 7번에서 차트 패널이 붙고 8번에서 채팅 패널이 붙는데,
그때도 고정 배치로 버틸 수 있으면 dockview는 계속 미룬다. 창을 나누고 싶어지는 순간 도입.

---

## 깨면 안 되는 것

새 세션이 무심코 되돌리기 쉬운 것들. 전부 이유가 있어서 그렇게 돼 있다.

- **그래프 편집은 `applyCommand`만 거친다.** 스토어 직접 수정 금지. AI 편집(8번)이 같은 길을 타야 한다.
- **`types.gen.ts`는 손으로 고치지 않는다.** 스키마를 바꿨으면 `npm run gen:types`.
- **shape 공식은 `compile.py`와 `shapes.ts` 양쪽에 있다.** 한쪽만 고치면 캔버스에서는 연결되는데 학습이 터진다.
  `examples/shape_cases.json`을 양쪽 테스트가 같이 돌리므로, 공식을 바꾸면 그쪽 테스트가 먼저 깨진다.
- **RF 노드 객체를 매 렌더 새로 만들지 않는다.** `measured`를 잃으면 React Flow가
  전부 `visibility:hidden`으로 그렸다가 다시 잰다 = 캔버스 깜빡임. `graph/rf.ts:syncRFNodes`가 껍데기를 물려준다.
- **선택 상태는 React Flow가 소유한다.** 우리가 또 들면 두 벌이 어긋난다.
- **`handleSet` debounce는 안 쓴다.** 시간 창이 편집의 성격을 구분하지 못해서 별개 편집을 한 칸으로 합친다.
  드래그는 `onNodeDragStop`에서 `move_node` 한 번으로 막는다. (CLAUDE.md 8번에 반영됨)
- **zundo `equality: shallow`.** 없으면 그래프와 무관한 필드 변경까지 undo 한 칸을 먹는다.
- **`graphStore`에만 zundo를 건다.** 7번에서 만들 `runStore`에는 절대 걸지 말 것.

---

## 미검증 / 알려진 구멍

- **핀 드래그로 엣지 잇기 — 미검증.** 브라우저 자동화의 합성 드래그가 React Flow의 d3-drag를
  건드리지 못해 확인을 못 했다. 로직(`connectionError`, connect command)은 검사로 덮여 있지만
  제스처 자체는 사람이 한 번 해봐야 한다. **7번 시작 전에 손으로 확인할 것.**
- **두 번째 파일 로드 시 fitView — 미검증.** 네이티브 파일 선택창을 자동화로 못 열었다.
  툴바가 로드 후 `useReactFlow().fitView()`를 직접 부르는 구조라 되어야 맞다.
- 파라미터 값 검증이 클라이언트에 없다 (zod 미설치). spec의 `min`만 본다. 최종 검증은 pydantic.
- command 레이어는 shape을 거부하지 않는다. 트랜잭션 중간 상태가 일시적으로 안 맞을 수 있어서.
  대신 노드가 빨갛게 된다. **AI 편집(8번)이 붙으면 이 판단을 다시 볼 것.**
- 자동 배치는 깊이×세로 한 칸짜리다. Inception 브랜치가 굵어지면 겹친다 → dagre.
- 저장은 브라우저 다운로드다. Tauri 셸이 붙으면 파일 다이얼로그로 교체.
- 다입력 노드(Add/Concat)가 없다. 노드당 입력 1개를 스키마·컴파일러·command가 모두 가정한다.
  GoogLeNet/ResNet을 하려면 여기부터 손대야 한다 (7번 다음이 아니라 별건).

---

## 다음: 7번 — WS + 학습 metric 스트리밍 + 차트

### 순서

1. **`train.py`의 학습 루프를 콜백 받는 함수로 분리한다.**
   지금은 `main()` 안에 루프가 박혀 있다. CLI와 서버가 같은 루프를 써야 나중에 안 갈라진다.
   `def train(g, on_metric) -> None` 정도. CLI는 `on_metric=print`, 서버는 WS push.

2. **`backend/server.py` (FastAPI + uvicorn).**
   - `fastapi`, `uvicorn` 의존성 추가 (`backend/pyproject.toml`)
   - `POST /compile` — 그래프 검증만. 캔버스가 학습 전에 부르는 최종 확인 (CLAUDE.md 3번의 서버 쪽 검증)
   - `WS /train` — 그래프 JSON 받고 학습 시작, step/epoch마다 metric push
   - 엔진 브릿지(11번)도 같은 WS 서버에 붙는다. 포트 하나(127.0.0.1)로 끝낼 것.
   - 학습은 별도 스레드/태스크로. 이벤트 루프를 막으면 WS가 죽는다.

3. **프론트 `runStore`** — 학습 상태(러닝/정지/에러)만. **zundo 걸지 않는다.**

4. **metric은 React 상태에 넣지 않는다** (CLAUDE.md 7번).
   초당 수십 개가 온다. ref 버퍼에 쌓고 rAF로 uPlot에 직접 주입. 차트는 React 렌더 사이클 밖.
   `npm i uplot` 필요.

5. 차트 패널 자리는 캔버스 아래 가로 분할 정도로 시작. 여기서 dockview가 필요해지면 6번을 제대로 한다.

6. 노드 위 gradient norm / loss 오버레이는 그 다음. `BaseNode`가 이미 `data.shape`/`data.error`를
   받아 그리므로 같은 자리에 얹으면 된다.

### 주의

- **GPU 경합**: 학습과 로컬 LLM이 같은 GPU를 쓴다. 8번에서 로컬 모델을 붙일 때
  학습 중 호출하면 OOM이 나거나 학습이 기어간다. 학습 중엔 API 모델로 넘기거나 LLM 언로드.
- **체크포인트는 그래프 버전과 쌍으로** 저장한다 (9번). 안 그러면 롤백해도 가중치가 안 맞는다.
- 학습 중 그래프 편집을 어떻게 할지 정해야 한다. 가장 싼 답은 학습 중 편집 잠금.

---

## 그 뒤

8. 채팅 패널 → AI 편집. **command JSON을 뱉게 한다.** PyTorch 코드가 아니다.
   AI 레이어는 처음부터 별도 모듈로 (오픈코어 전환 여지).
9. 버전 히스토리 (그래프 스냅샷 + 체크포인트 페어링)
10. 데이터 드래그 앤 드롭 (UI는 경로만, 타입 추론은 sidecar)
11. UE5 / Unity 브릿지

`CLAUDE.md`는 gitignore돼 있다(`.gitignore:2`). 이 문서는 커밋된다.
