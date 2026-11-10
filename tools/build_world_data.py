"""전 세계 해안선·항구 데이터를 받아 앱이 쓰는 파일로 저장합니다.

    python tools/build_world_data.py

결과 파일 (앱이 시작할 때 불러옴):
    public/data/world/land.json   육지 다각형 (Natural Earth 1:10m 육지 + 작은 섬)
    public/data/world/ports.json  항구 목록 (UN/LOCODE에서 '항구' 기능이 있고 바다 가까이 있는 곳)

내려받은 원본은 tools/.cache/에 보관하므로 두 번째 실행부터는 네트워크 없이 다시 만들 수 있습니다.
(원본을 새로 받으려면 tools/.cache/ 폴더를 지우세요.)
표준 라이브러리만 사용하므로 따로 설치할 패키지가 없습니다.

데이터 출처와 이용 조건
    Natural Earth (naturalearthdata.com)  퍼블릭 도메인
    UN/LOCODE (unece.org, datahub.io 정리본)  자유 이용
"""

from __future__ import annotations

import csv
import json
import math
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
SOURCES = {
    "ne_10m_land.geojson": NE_BASE + "ne_10m_land.geojson",
    "ne_10m_minor_islands.geojson": NE_BASE + "ne_10m_minor_islands.geojson",
    "ne_10m_ports.geojson": NE_BASE + "ne_10m_ports.geojson",
    "unlocode.csv": "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv",
}

# 좌표를 이 값으로 곱해 정수로 저장 (1000 → 0.001° ≈ 110 m 단위)
SCALE = 1000
# 해안선 단순화 허용 오차 (정수 단위). 1.5 → 약 170 m 이내로 어긋나는 점은 생략
SIMPLIFY_TOL = 1.5

# 항구 좌표에서 이 거리 안에 바다가 없으면 내륙항으로 보고 제외 (km)
PORT_MAX_SEA_KM = 30
# 항구 필터용 육지 격자 크기 (도)
RASTER_DEG = 0.05

# 화면에 한국어 이름으로 보일 항구 (UN/LOCODE → 이름). 검색도 이 이름으로 됩니다.
KO_NAMES = {
    # 대한민국
    "KRPUS": "부산", "KRBNP": "부산신항", "KRKPO": "포항", "KRSHG": "포항 신항", "KRULL": "울릉(사동)",
    "KRHPO": "후포", "KRMUK": "묵호", "KRTGH": "동해", "KRSUK": "삼척", "KRSHO": "속초", "KRJMJ": "주문진",
    "KROKK": "옥계", "KRGRP": "구룡포", "KRDDO": "독도", "KRUSN": "울산", "KRONS": "온산", "KRMIP": "미포",
    "KRINC": "인천", "KRPTK": "평택", "KRTJI": "당진", "KRTSN": "대산", "KRBOR": "보령", "KRKUV": "군산",
    "KRMOK": "목포", "KRWND": "완도", "KRKAN": "광양", "KRYOS": "여수", "KRSCP": "삼천포", "KRTYG": "통영",
    "KRKJE": "거제", "KROKP": "옥포", "KRMAS": "마산", "KRCHF": "진해", "KRCHA": "제주", "KRSPO": "서귀포",
    "KRSSP": "성산포",
    # 주요 해외 항구
    "JPTYO": "도쿄", "JPYOK": "요코하마", "JPNGO": "나고야", "JPOSA": "오사카", "JPUKB": "고베",
    "JPHKT": "후쿠오카(하카타)", "JPSMZ": "시미즈", "JPNGS": "나가사키", "JPMOJ": "모지", "JPSMN": "사카이미나토",
    "CNSGH": "상하이", "CNSHG": "상하이(양산)", "CNNBG": "닝보", "CNQDG": "칭다오", "CNTXG": "톈진(신강)",
    "CNDAG": "다롄", "CNXMG": "샤먼",
    "CNYTN": "옌톈(선전)", "HKHKG": "홍콩", "TWKHH": "가오슝", "RUVVO": "블라디보스토크", "RUNJK": "나홋카",
    "SGSIN": "싱가포르", "MYPKG": "포트클랑", "THLCH": "람차방", "VNSGN": "호찌민", "VNHPH": "하이퐁",
    "PHMNL": "마닐라", "IDJKT": "자카르타", "LKCMB": "콜롬보", "INNSA": "뭄바이(나바셰바)",
    "AEJEA": "두바이(제벨알리)", "OMSLL": "살랄라", "SAJED": "제다", "EGPSD": "포트사이드", "EGSUZ": "수에즈",
    "NLRTM": "로테르담", "BEANR": "안트베르펜", "DEHAM": "함부르크", "DEBRV": "브레머하펜", "GBFXT": "펠릭스토우",
    "GBSOU": "사우샘프턴", "FRLEH": "르아브르", "FRMRS": "마르세유", "ESALG": "알헤시라스", "ESVLC": "발렌시아",
    "ESBCN": "바르셀로나", "ITGOA": "제노바", "GRPIR": "피레우스", "TRIST": "이스탄불", "PTSIE": "시네스",
    "ZADUR": "더반", "ZACPT": "케이프타운", "USLAX": "로스앤젤레스", "USLGB": "롱비치", "USOAK": "오클랜드(미국)",
    "USSEA": "시애틀", "CAVAN": "밴쿠버", "USHNL": "호놀룰루", "USNYC": "뉴욕", "USSAV": "서배너",
    "USHOU": "휴스턴", "USMIA": "마이애미", "PABLB": "발보아(파나마)", "PAONX": "콜론(파나마)",
    "BRSSZ": "산투스", "ARBUE": "부에노스아이레스", "CLVAP": "발파라이소", "PECLL": "카야오",
    "AUSYD": "시드니", "AUMEL": "멜버른", "AUBNE": "브리즈번", "NZAKL": "오클랜드(뉴질랜드)",
}

# UN/LOCODE와 Natural Earth 어디에도 좌표가 없는 주요 항구 (경도, 위도)
MANUAL_COORDS = {
    "AEJEA": (55.03, 25.01),   # Jebel Ali
    "GBFXT": (1.32, 51.95),    # Felixstowe
    "JPNGO": (136.85, 35.05),  # Nagoya
    "JPSMN": (133.25, 35.55),  # Sakaiminato
    "OMSLL": (54.0, 16.94),    # Salalah
    "AZBAK": (49.87, 40.35),   # Baku (카스피해)
}

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
OUT_DIR = ROOT / "public" / "data" / "world"
OUT_LAND = OUT_DIR / "land.json"
OUT_PORTS = OUT_DIR / "ports.json"

# ---------------------------------------------------------------------------
# 내려받기
# ---------------------------------------------------------------------------


def cached(name: str) -> Path:
    path = CACHE_DIR / name
    if not path.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        print(f"내려받는 중: {SOURCES[name]}")
        req = urllib.request.Request(SOURCES[name], headers={"User-Agent": "SAFE-Route-data-tool"})
        with urllib.request.urlopen(req, timeout=120) as res:
            data = res.read()
        path.write_bytes(data)
    return path


# ---------------------------------------------------------------------------
# 육지 다각형
# ---------------------------------------------------------------------------


def ring_area2(ring: list[tuple[int, int]]) -> int:
    """신발끈 공식으로 구한 넓이 × 2. 양수면 반시계 방향."""
    s = 0
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return s


def simplify(points: list[tuple[int, int]], tol: float) -> list[tuple[int, int]]:
    """더글러스-포이커 단순화 (열린 선). 처음과 끝 점은 항상 남김."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    tol2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        best, best_d2 = -1, tol2
        for i in range(a + 1, b):
            px, py = points[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                cross = dx * (py - ay) - dy * (px - ax)
                d2 = cross * cross / seg2
            if d2 > best_d2:
                best, best_d2 = i, d2
        if best >= 0:
            keep[best] = True
            stack.append((a, best))
            stack.append((best, b))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring: list[tuple[int, int]], tol: float) -> list[tuple[int, int]]:
    """닫힌 고리 단순화: 첫 점과 가장 먼 점에서 둘로 나눠 각각 단순화."""
    if len(ring) < 4:
        return ring
    x0, y0 = ring[0]
    far = max(range(len(ring)), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
    first = simplify(ring[: far + 1], tol)
    second = simplify(ring[far:] + [ring[0]], tol)
    return first[:-1] + second[:-1]


def load_rings() -> list[list[tuple[int, int]]]:
    """GeoJSON 다각형 → 정수 좌표 고리 목록. 바깥 고리는 반시계, 구멍은 시계 방향으로 맞춤."""
    rings = []
    for name in ("ne_10m_land.geojson", "ne_10m_minor_islands.geojson"):
        data = json.loads(cached(name).read_text(encoding="utf-8"))
        for feature in data["features"]:
            geom = feature["geometry"]
            polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
            for polygon in polygons:
                for idx, coords in enumerate(polygon):
                    ring: list[tuple[int, int]] = []
                    for x, y in coords:
                        p = (round(x * SCALE), round(y * SCALE))
                        if not ring or ring[-1] != p:
                            ring.append(p)
                    if len(ring) > 1 and ring[0] == ring[-1]:
                        ring.pop()
                    ring = simplify_ring(ring, SIMPLIFY_TOL)
                    if len(ring) < 3:
                        continue
                    area = ring_area2(ring)
                    if area == 0:
                        continue
                    is_outer = idx == 0
                    if (area > 0) != is_outer:
                        ring.reverse()
                    rings.append(ring)
    return rings


def encode_ring(ring: list[tuple[int, int]]) -> list[int]:
    """[x0, y0, dx1, dy1, dx2, dy2, ...] (첫 점 다음부터는 앞 점과의 차이)."""
    out = [ring[0][0], ring[0][1]]
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        out += [bx - ax, by - ay]
    return out


# ---------------------------------------------------------------------------
# 항구 필터용 육지 격자 (앱의 land.js와 같은 방식: 칸 중심이 육지 안이면 육지, nonzero 규칙)
# ---------------------------------------------------------------------------


class LandRaster:
    def __init__(self, rings: list[list[tuple[int, int]]], deg: float):
        self.deg = deg
        self.nx = round(360 / deg)
        self.ny = round(180 / deg)
        self.land = bytearray(self.nx * self.ny)
        rows: list[list[tuple[float, int]]] = [[] for _ in range(self.ny)]
        for ring in rings:
            n = len(ring)
            for i in range(n):
                x0, y0 = ring[i][0] / SCALE, ring[i][1] / SCALE
                x1, y1 = ring[(i + 1) % n][0] / SCALE, ring[(i + 1) % n][1] / SCALE
                if y0 == y1:
                    continue
                lo, hi = (y0, y1) if y0 < y1 else (y1, y0)
                # 칸 중심 위도 y_j = -90 + (j + 0.5) * deg 가 [lo, hi) 안에 드는 행
                j0 = math.ceil((lo + 90) / deg - 0.5)
                j1 = math.ceil((hi + 90) / deg - 0.5)
                direction = 1 if y1 > y0 else -1
                for j in range(max(j0, 0), min(j1, self.ny)):
                    y = -90 + (j + 0.5) * deg
                    rows[j].append((x0 + (y - y0) * (x1 - x0) / (y1 - y0), direction))
        for j, crossings in enumerate(rows):
            crossings.sort()
            winding = 0
            base = j * self.nx
            for k, (x, d) in enumerate(crossings):
                before = winding
                winding += d
                if before == 0 and winding != 0:
                    start = x
                elif before != 0 and winding == 0:
                    i0 = max(0, math.ceil((start + 180) / deg - 0.5))
                    i1 = min(self.nx, math.ceil((x + 180) / deg - 0.5))
                    if i1 > i0:
                        self.land[base + i0 : base + i1] = b"\x01" * (i1 - i0)

    def is_land(self, i: int, j: int) -> bool:
        return self.land[j * self.nx + (i % self.nx)] == 1

    def km_to_sea(self, lon: float, lat: float, max_km: float) -> float | None:
        """가장 가까운 바다 칸까지 거리 (km). max_km 안에 없으면 None."""
        i0 = math.floor((lon + 180) / self.deg)
        j0 = math.floor((lat + 90) / self.deg)
        km_lat = self.deg * 111.2
        km_lon = max(self.deg * 111.32 * math.cos(math.radians(lat)), 0.5)
        rj = math.ceil(max_km / km_lat)
        ri = math.ceil(max_km / km_lon)
        best = None
        for dj in range(-rj, rj + 1):
            j = j0 + dj
            if j < 0 or j >= self.ny:
                continue
            for di in range(-ri, ri + 1):
                if self.is_land(i0 + di, j):
                    continue
                d = math.hypot(di * km_lon, dj * km_lat)
                if d <= max_km and (best is None or d < best):
                    best = d
        return best


# ---------------------------------------------------------------------------
# 항구
# ---------------------------------------------------------------------------


def parse_coord(text: str) -> tuple[float, float] | None:
    """UN/LOCODE 좌표 '3508N 12903E' → (경도, 위도)."""
    parts = text.split()
    if len(parts) != 2:
        return None
    lat_s, lon_s = parts
    try:
        lat = int(lat_s[:2]) + int(lat_s[2:4]) / 60
        lon = int(lon_s[:3]) + int(lon_s[3:5]) / 60
    except ValueError:
        return None
    if lat_s[-1] == "S":
        lat = -lat
    if lon_s[-1] == "W":
        lon = -lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lon, lat


def km_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * 111.32 * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (a[1] - b[1]) * 111.2
    return math.hypot(dx, dy)


def name_key(name: str) -> str:
    """항구 이름 비교용 정규화: 악센트·괄호·'Port' 같은 말을 빼고 소문자로."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z ]", " ", s)
    s = re.sub(r"\b(pt|port|harbour|harbor)\b", " ", s)
    return " ".join(s.split())


class NearestCountry:
    """좌표가 주어지면 가장 가까운 UN/LOCODE 지명의 국가 코드를 돌려줌 (Natural Earth 항구에는 국가 정보가 없어서)."""

    def __init__(self, rows: list[dict]):
        self.cells: dict[tuple[int, int], list[tuple[str, float, float]]] = {}
        for row in rows:
            pos = parse_coord(row["Coordinates"])
            if pos:
                self.cells.setdefault((math.floor(pos[0]), math.floor(pos[1])), []).append((row["Country"], *pos))

    def __call__(self, lon: float, lat: float) -> str | None:
        best: tuple[float, str] | None = None
        for i in range(math.floor(lon) - 1, math.floor(lon) + 2):
            for j in range(math.floor(lat) - 1, math.floor(lat) + 2):
                for country, x, y in self.cells.get((i, j), ()):
                    d = km_between((lon, lat), (x, y))
                    if best is None or d < best[0]:
                        best = (d, country)
        return best[1] if best else None


def load_ports(raster: LandRaster) -> tuple[list[list], dict]:
    """UN/LOCODE 항구 + Natural Earth 주요 항구를 합친 목록.

    UN/LOCODE는 항구가 많지만 큰 항구 상당수에 좌표가 없고(Jebel Ali, Port Said 등),
    좌표가 있어도 도시 중심인 경우가 많습니다. Natural Earth 항구는 1천여 곳뿐이지만
    부두 위치가 정확하므로, 국가·이름이 같으면 Natural Earth 좌표를 쓰고 'major'로 표시합니다.
    """
    rows = list(csv.DictReader(cached("unlocode.csv").open(encoding="utf-8", newline="")))
    country_at = NearestCountry(rows)

    ne_ports: dict[tuple[str, str], dict] = {}
    for f in json.loads(cached("ne_10m_ports.geojson").read_text(encoding="utf-8"))["features"]:
        lon, lat = f["geometry"]["coordinates"]
        country = country_at(lon, lat)
        if country:
            ne_ports.setdefault((country, name_key(f["properties"]["name"])),
                                {"name": f["properties"]["name"], "pos": (lon, lat), "id": f["properties"]["ne_id"], "used": False})

    ports = []
    stats = {"inland": 0, "no_coord": 0, "from_ne": 0, "manual": 0, "ne_only": 0}

    def add(locode: str, name: str, pos: tuple[float, float], major: bool) -> None:
        if raster.km_to_sea(pos[0], pos[1], PORT_MAX_SEA_KM) is None:
            stats["inland"] += 1
            return
        entry = [locode, name, round(pos[0], 3), round(pos[1], 3), 1 if major or locode in KO_NAMES else 0]
        if locode in KO_NAMES:
            entry.append(KO_NAMES[locode])
        ports.append(entry)

    for row in rows:
        if not row["Function"].startswith("1") or row["Status"] == "XX":
            continue
        locode = row["Country"] + row["Location"]
        pos = parse_coord(row["Coordinates"])
        ne = ne_ports.get((row["Country"], name_key(row["Name"])))
        if ne and (pos is None or km_between(pos, ne["pos"]) < 50):
            pos = ne["pos"]
            ne["used"] = True
            stats["from_ne"] += 1
        elif pos is None and locode in MANUAL_COORDS:
            pos = MANUAL_COORDS[locode]
            stats["manual"] += 1
        if pos is None:
            stats["no_coord"] += 1
            continue
        add(locode, row["Name"], pos, ne is not None and ne["used"])

    # UN/LOCODE에 짝이 없는 Natural Earth 항구는 'NE' + 번호로 추가 (국가는 가장 가까운 지명 기준)
    for (country, _), ne in ne_ports.items():
        if not ne["used"]:
            add(f"{country}~{ne['id']}", ne["name"], ne["pos"], True)
            stats["ne_only"] += 1

    ports.sort(key=lambda p: p[0])
    return ports, stats


# ---------------------------------------------------------------------------


def main() -> None:
    rings = load_rings()
    points = sum(len(r) for r in rings)
    print(f"육지 고리 {len(rings):,}개, 점 {points:,}개")

    print("항구 필터용 육지 격자 만드는 중…")
    raster = LandRaster(rings, RASTER_DEG)
    ports, st = load_ports(raster)
    print(f"항구 {len(ports):,}곳, 그중 주요 항구 {sum(p[4] for p in ports):,}곳")
    print(f"  좌표: Natural Earth {st['from_ne']:,} · 직접 입력 {st['manual']} · Natural Earth에만 있는 항구 {st['ne_only']:,}")
    print(f"  제외: 좌표 없음 {st['no_coord']:,} · 바다에서 {PORT_MAX_SEA_KM} km보다 먼 내륙항 {st['inland']:,}")
    have = {p[0] for p in ports}
    missing = [k for k in KO_NAMES if k not in have]
    if missing:
        print(f"  (한국어 이름 목록 중 데이터에 없는 항구: {', '.join(missing)})", file=sys.stderr)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    land = {
        "source": "Natural Earth 1:10m land + minor islands (public domain)",
        "generatedAt": now,
        "scale": SCALE,
        "note": "rings: [x0, y0, dx1, dy1, ...] 정수 (÷scale = 도). 바깥 고리는 반시계, 구멍은 시계 방향 (nonzero 규칙).",
        "rings": [encode_ring(r) for r in rings],
    }
    OUT_LAND.write_text(json.dumps(land, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    out_ports = {
        "source": "UN/LOCODE code list (function 1 = port) + Natural Earth 1:10m ports (major=1, coordinates preferred)",
        "generatedAt": now,
        "fields": ["locode", "name", "lon", "lat", "major", "ko?"],
        "ports": ports,
    }
    OUT_PORTS.write_text(json.dumps(out_ports, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for path in (OUT_LAND, OUT_PORTS):
        print(f"→ {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
