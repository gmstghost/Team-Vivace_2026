"""OBIS에서 '피해야 할 대상' 생물의 출현 기록을 받아 앱이 쓰는 CSV로 저장합니다.

    python tools/fetch_obis_targets.py

결과 파일 (앱이 자동으로 불러옴):
    public/data/obis_targets.csv        출현 기록 (분류군, 학명, 위도, 경도, 연도)
    public/data/obis_targets.meta.json  분류군 목록·건수·생성 시각

대상을 바꾸려면 아래 TARGET_GROUPS만 고친 뒤 다시 실행하세요.
학명은 WoRMS/OBIS 기준이며, 상위 분류군(예: Cetacea)을 적으면 하위 종이 모두 포함됩니다.
표준 라이브러리만 사용하므로 따로 설치할 패키지가 없습니다.
"""

from __future__ import annotations

import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

# public/js/model/config.js 의 BOUNDS와 같아야 합니다.
BOUNDS = {"lon0": 129.0, "lon1": 131.2, "lat0": 35.8, "lat1": 37.8}

# 이 연도 이전 기록은 버림. None이면 연도 제한 없음 (기록이 적은 분류군이 많아 기본은 제한 없음)
MIN_YEAR: int | None = None

TARGET_GROUPS = [
    {"key": "jellyfish", "label": "대형 해파리",       "taxa": ["Scyphozoa"]},          # 해파리강 (노무라입깃해파리 등)
    {"key": "fouling",   "label": "부착 생물",         "taxa": ["Ciona", "Cirripedia"]},  # 유령멍게속, 따개비류
    {"key": "cetacean",  "label": "고래·돌고래류",     "taxa": ["Cetacea"]},
    {"key": "turtle",    "label": "바다거북",          "taxa": ["Chelonioidea"]},       # 바다거북과 + 장수거북과
    {"key": "pinniped",  "label": "물범·물개",         "taxa": ["Phocidae", "Otariidae"]},
]

API = "https://api.obis.org/v3/occurrence"
PAGE_SIZE = 5000
FIELDS = "id,decimalLongitude,decimalLatitude,scientificName,date_year"

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data"
OUT_CSV = OUT_DIR / "obis_targets.csv"
OUT_META = OUT_DIR / "obis_targets.meta.json"

# ---------------------------------------------------------------------------


def region_wkt() -> str:
    b = BOUNDS
    corners = [(b["lon0"], b["lat0"]), (b["lon1"], b["lat0"]), (b["lon1"], b["lat1"]), (b["lon0"], b["lat1"]), (b["lon0"], b["lat0"])]
    return "POLYGON((" + ",".join(f"{x} {y}" for x, y in corners) + "))"


def get_json(params: dict, retries: int = 3) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "SAFE-Route-data-tool"})
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.load(res)
        except Exception as e:  # 네트워크 오류는 잠시 후 재시도
            if attempt == retries - 1:
                raise
            print(f"    재시도 ({e})", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def fetch_taxon(name: str) -> list[dict]:
    """한 분류군의 해역 내 기록을 모두 받음 (after 커서로 페이지 넘김)."""
    records: list[dict] = []
    params = {"geometry": region_wkt(), "scientificname": name, "size": PAGE_SIZE, "fields": FIELDS}
    while True:
        page = get_json(params)
        results = page.get("results", [])
        records.extend(results)
        if len(results) < PAGE_SIZE:
            return records
        params["after"] = results[-1]["id"]


def in_bounds(lon: float, lat: float) -> bool:
    return BOUNDS["lon0"] <= lon < BOUNDS["lon1"] and BOUNDS["lat0"] <= lat < BOUNDS["lat1"]


def main() -> None:
    rows: list[dict] = []
    meta_groups = []

    for group in TARGET_GROUPS:
        seen: set[tuple] = set()
        kept = 0
        raw_total = 0
        for taxon in group["taxa"]:
            raw = fetch_taxon(taxon)
            raw_total += len(raw)
            for r in raw:
                try:
                    lon, lat = float(r["decimalLongitude"]), float(r["decimalLatitude"])
                except (KeyError, TypeError, ValueError):
                    continue
                year = r.get("date_year")
                if not in_bounds(lon, lat):
                    continue
                if MIN_YEAR is not None and (year is None or year < MIN_YEAR):
                    continue
                name = r.get("scientificName", "")
                # 같은 종·같은 지점(약 10 m)·같은 해의 중복 기록은 하나로 (여러 데이터셋에 중복 등록된 경우)
                key = (name, round(lon, 4), round(lat, 4), year)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "group": group["key"],
                    "scientificName": name,
                    "decimalLatitude": round(lat, 5),
                    "decimalLongitude": round(lon, 5),
                    "year": year if year is not None else "",
                })
                kept += 1
            time.sleep(0.3)  # API 예의
        print(f"{group['label']:<10} {', '.join(group['taxa']):<28} 받음 {raw_total:>5}건 → 사용 {kept:>5}건")
        meta_groups.append({"key": group["key"], "label": group["label"], "taxa": group["taxa"], "count": kept})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["group", "scientificName", "decimalLatitude", "decimalLongitude", "year"])
        writer.writeheader()
        writer.writerows(rows)

    meta = {
        "source": "OBIS (https://obis.org) via api.obis.org/v3",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": BOUNDS,
        "minYear": MIN_YEAR,
        "groups": meta_groups,
    }
    OUT_META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n총 {len(rows)}건 → {OUT_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
