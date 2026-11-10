"""OBIS에서 '피해야 할 대상' 생물의 전 세계 출현 기록 수를 격자로 받아 앱이 쓰는 파일로 저장합니다.

    python tools/fetch_obis_targets.py

결과 파일 (앱이 시작할 때 불러옴):
    public/data/obis_targets.json   분류군별 [경도, 위도, 기록 수] 격자 (전 세계 기본값)

전 세계 기록을 한 점씩 받으면 수백만 건이라, OBIS가 지오해시 격자로 세어 주는
/occurrence/grid API를 씁니다. 이 파일에는 정밀도 3 (약 1.4° ≈ 150 km 칸)을 저장하고,
앱은 항로가 정해지면 그 해역만 더 촘촘한 격자(정밀도 4~5)로 OBIS에서 바로 받아 덮어씁니다
(model/occurrences.js의 fetchDetail). 그래서 이 파일은 인터넷이 안 될 때의 대비이자 첫 화면용입니다.

대상을 바꾸려면 아래 TARGET_GROUPS만 고친 뒤 다시 실행하세요.
학명은 WoRMS/OBIS 기준이며, 상위 분류군(예: Cetacea)을 적으면 하위 종이 모두 포함됩니다.
표준 라이브러리만 사용하므로 따로 설치할 패키지가 없습니다.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# 설정 — public/js/model/occurrences.js 의 TARGET_GROUPS와 같아야 합니다.
# ---------------------------------------------------------------------------

TARGET_GROUPS = [
    {"key": "jellyfish", "label": "대형 해파리",   "taxa": ["Scyphozoa"]},           # 해파리강 (노무라입깃해파리 등)
    {"key": "fouling",   "label": "부착 생물",     "taxa": ["Ciona", "Cirripedia"]},  # 유령멍게속, 따개비류
    {"key": "cetacean",  "label": "고래·돌고래류", "taxa": ["Cetacea"]},
    {"key": "turtle",    "label": "바다거북",      "taxa": ["Chelonioidea"]},        # 바다거북과 + 장수거북과
    {"key": "pinniped",  "label": "물범·물개",     "taxa": ["Phocidae", "Otariidae"]},
]

# 지오해시 정밀도: 3 ≈ 1.41° × 1.41°, 4 ≈ 0.35° × 0.18°, 5 ≈ 0.044° × 0.044°
PRECISION = 3
CELL_DEG = {3: (1.40625, 1.40625), 4: (0.3515625, 0.17578125), 5: (0.0439453125, 0.0439453125)}

API = "https://api.obis.org/v3/occurrence/grid/{precision}"

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "public" / "data" / "obis_targets.json"

# ---------------------------------------------------------------------------


def get_json(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "SAFE-Route-data-tool"})
            with urllib.request.urlopen(req, timeout=180) as res:
                return json.load(res)
        except Exception as e:  # 네트워크 오류는 잠시 후 재시도
            if attempt == retries - 1:
                raise
            print(f"    재시도 ({e})", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch_group(taxa: list[str]) -> dict[tuple[float, float], int]:
    """분류군(여러 학명 가능)의 전 세계 격자별 기록 수. 키는 칸 중심 (경도, 위도)."""
    params = urllib.parse.urlencode({"scientificname": ",".join(taxa)})
    data = get_json(f"{API.format(precision=PRECISION)}?{params}")
    cells: dict[tuple[float, float], int] = {}
    for feature in data.get("features", []):
        ring = feature["geometry"]["coordinates"][0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        center = (round((min(xs) + max(xs)) / 2, 4), round((min(ys) + max(ys)) / 2, 4))
        cells[center] = cells.get(center, 0) + int(feature["properties"]["n"])
    return cells


def main() -> None:
    groups = []
    total_cells = 0
    for group in TARGET_GROUPS:
        cells = fetch_group(group["taxa"])
        records = sum(cells.values())
        flat: list[float] = []
        for (lon, lat), n in sorted(cells.items()):
            flat += [lon, lat, n]
        groups.append({**group, "count": records, "cells": flat})
        total_cells += len(cells)
        print(f"{group['label']:<10} {', '.join(group['taxa']):<26} 칸 {len(cells):>6,}개 · 기록 {records:>11,}건")
        time.sleep(0.5)  # API 예의

    out = {
        "source": "OBIS (https://obis.org) via api.obis.org/v3/occurrence/grid",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "precision": PRECISION,
        "cellDeg": CELL_DEG[PRECISION],
        "note": "groups[].cells = [경도, 위도, 기록 수, ...] (지오해시 칸 중심)",
        "groups": groups,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"\n칸 {total_cells:,}개 → {OUT_FILE.relative_to(ROOT)} ({OUT_FILE.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
