# Team-Vivace_2026 · SAFE Route

해양 생물 분포로 생태 민감 구역을 찾고, 그 구역을 피해 가는 항로를 계산하는 웹 시뮬레이터입니다.

## 폴더 구조

```
SAFE_Route/
├── firebase.json            Firebase Hosting 설정 (public/ 폴더를 배포)
├── serve.py                 로컬 개발 서버 (python serve.py)
└── public/                  ← 배포되는 파일은 전부 여기
    ├── index.html           화면 구조
    ├── css/style.css        디자인
    ├── arduino/
    │   └── safe_route_sensor.ino   아두이노 스케치 (페이지에서 표시·내려받기)
    └── js/
        ├── main.js          진입점: 화면 요소와 계산을 연결
        ├── model/           순수 계산 (DOM 없음, Node로 테스트 가능)
        │   ├── config.js        상수: 해역 범위, 해안선, 항구
        │   ├── grid.js          격자와 육지 판정
        │   ├── occurrences.js   출현 기록: 예시 데이터, CSV, OBIS API
        │   ├── density.js       1·2단계: 커널 밀도 추정, 수온 보정 위험도
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

## 데이터

- 처음 화면의 출현 기록은 동작을 보여 주려고 만든 **가상 예시**입니다.
- 실데이터: 페이지의 "OBIS에서 불러오기" 버튼, 또는 [obis.org](https://obis.org)에서 내려받은 CSV를 불러옵니다.
  CSV에는 위도·경도 열(`decimalLatitude`/`decimalLongitude` 또는 `위도`/`경도`)만 있으면 됩니다.
