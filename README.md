# Team-Vivace_2026 · SAFE Route

해양 생물 분포로 생태 민감 구역을 찾고, 그 구역을 피해 가는 항로를 계산하는 웹 시뮬레이터입니다.

## 폴더 구조

```
SAFE_Route/
├── firebase.json            Firebase Hosting 설정 (public/ 폴더를 배포)
├── serve.py                 로컬 개발 서버 (python serve.py)
├── tools/
│   └── fetch_obis_targets.py   OBIS에서 보호 대상 생물 기록을 받아 public/data/에 저장
└── public/                  ← 배포되는 파일은 전부 여기
    ├── index.html           화면 구조
    ├── css/style.css        디자인
    ├── data/                fetch_obis_targets.py가 만든 데이터 (앱이 시작할 때 불러옴)
    ├── arduino/
    │   └── safe_route_sensor.ino   아두이노 스케치 (페이지에서 표시·내려받기)
    └── js/
        ├── main.js          진입점: 화면 요소와 계산을 연결
        ├── model/           순수 계산 (DOM 없음, Node로 테스트 가능)
        │   ├── config.js        상수: 해역 범위, 해안선, 항구
        │   ├── grid.js          격자와 육지 판정
        │   ├── occurrences.js   출현 기록: 보호 대상 데이터, CSV, 예시 데이터
        │   ├── density.js       1·2단계: 분류군별 커널 밀도 추정, 수온 보정 위험도
        │   ├── pathfinding.js   3단계: A* 탐색
        │   └── routing.js       기존/AI 항로 계산과 지표 측정
        └── ui/              화면
            ├── map-view.js      캔버스 해도 그리기
            ├── results.js       항로 비교 표·막대·요약 문장
            └── arduino.js       Web Serial로 아두이노 센서 읽기
```

수식이나 상수를 바꾸려면 `public/js/model/`만 보면 됩니다.

## Python 사용자를 위한 JS 대응표

| Python | 이 프로젝트의 JavaScript |
| --- | --- |
| `from .grid import NX, cell_of` | `import { NX, cellOf } from './grid.js';` |
| `def f(x):` | `export function f(x) { ... }` |
| `lambda x: x * 2` | `(x) => x * 2` |
| `f"{km:.1f} km"` | `` `${km.toFixed(1)} km` `` |
| `for lon, lat in points:` | `for (const [lon, lat] of points) { ... }` |
| `numpy.zeros(N, dtype=float32)` | `new Float32Array(N)` |
| `heapq` | `pathfinding.js`의 `MinHeap` 클래스 |
| `async def` / `await` | `async function` / `await` (거의 같음) |
| `if __name__ == "__main__":` | `main.js` |

## 로컬에서 실행

```bash
python serve.py
```

브라우저에서 <http://localhost:8000> 을 엽니다.

- ES 모듈(`import`)을 쓰기 때문에 `index.html`을 더블클릭해서 열면 동작하지 않습니다. 꼭 서버로 여세요.
- 아두이노 연결(Web Serial)은 PC의 Chrome·Edge에서 `localhost` 또는 HTTPS 주소일 때만 됩니다.

## Firebase Hosting으로 배포

처음 한 번:

```bash
npm install -g firebase-tools     # 이미 설치되어 있으면 생략
firebase login
firebase use --add                # Firebase 콘솔에서 만든 프로젝트 선택 → .firebaserc 생성
```

배포할 때마다:

```bash
firebase deploy --only hosting
```

`https://<프로젝트ID>.web.app` 주소가 나옵니다. HTTPS라서 아두이노 연결도 그대로 동작합니다.
배포 전에 Firebase 환경 그대로 확인하려면 `firebase emulators:start --only hosting`을 씁니다.

서버 쪽 코드가 없는 정적 사이트라 무료(Spark) 요금제로 충분합니다.

## 데이터: 피해야 할 대상 생물

앱은 시작할 때 `public/data/obis_targets.csv`를 불러옵니다. 이 파일은 OBIS에서 아래 분류군의 해역 내 기록만 받아 만든 것입니다.

| 화면 이름 | OBIS 학명 | 포함되는 생물 |
| --- | --- | --- |
| 대형 해파리 | Scyphozoa | 해파리강 (노무라입깃해파리, 보름달물해파리류 등) |
| 부착 생물 | Ciona, Cirripedia | 유령멍게속, 따개비류 |
| 고래·돌고래류 | Cetacea | 고래목 전체 |
| 바다거북 | Chelonioidea | 바다거북과, 장수거북과 |
| 물범·물개 | Phocidae, Otariidae | 물범과, 물개과 |

데이터를 새로 받거나 대상을 바꾸려면 `tools/fetch_obis_targets.py`의 `TARGET_GROUPS`를 고친 뒤 실행합니다.

```bash
python tools/fetch_obis_targets.py
```

- **분류군별 정규화**: 분류군마다 밀도를 따로 0~1로 맞춘 뒤 칸마다 가장 큰 값을 씁니다. 기록 수가 수백 건인 따개비가 몇 건뿐인 고래·물범을 덮지 않게 하기 위해서입니다. 화면에서 분류군을 켜고 끌 수 있습니다.
- **중복 제거**: 같은 종·같은 지점(약 10 m)·같은 해의 기록은 하나로 칩니다.
- **해안 기록**: 해안선이 단순화돼 있어 갯바위·항구의 기록이 육지 칸에 떨어지는 경우가 많습니다. 바다에서 3칸(약 6 km) 안쪽까지의 기록은 버리지 않고 씁니다.
- **한계**: OBIS 기록은 조사한 곳에만 남습니다. 기록이 없는 곳이 생물이 없는 곳은 아닙니다. 특히 해파리(7건)와 물범·물개(2건)는 기록이 매우 적습니다.

다른 데이터는 "CSV 불러오기"로 쓸 수 있습니다. CSV에는 위도·경도 열(`decimalLatitude`/`decimalLongitude` 또는 `위도`/`경도`)만 있으면 되고, `group` 열이 있으면 분류군별로 나눠 계산합니다. "예시 데이터"는 동작 확인용 **가상** 값입니다.
