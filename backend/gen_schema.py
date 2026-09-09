"""pydantic 스키마 -> JSON Schema 덤프. npm run gen:types가 이걸 부른다.

여기서 나온 JSON을 json-schema-to-typescript가 frontend/src/types.gen.ts로 바꾼다.
타입을 손으로 두 번 쓰지 않기 위한 파이프의 앞쪽 절반이다.
"""

import json
from pathlib import Path

from schema import Graph

OUT = Path(__file__).resolve().parent.parent / "frontend" / ".graph.schema.json"

if __name__ == "__main__":
    schema = Graph.model_json_schema()
    schema["title"] = "Graph"
    # 필드마다 붙는 title은 json2ts가 타입 별칭(Id1, Type2...)으로 뱉어서 지운다.
    for obj in [schema, *schema.get("$defs", {}).values()]:
        for prop in obj.get("properties", {}).values():
            prop.pop("title", None)
    OUT.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}")
