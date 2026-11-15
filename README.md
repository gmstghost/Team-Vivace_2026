# SAFE Route

**Team Vivace · 2026**

SAFE Route는 해양 보호 생물이 많이 사는 구역을 피해 가는 선박 항로를 계산하는 웹 시뮬레이터입니다.
OBIS 출현 기록으로 생태 민감 구역을 찾고, 수온과 선박 소음을 반영해 위험도를 매긴 뒤
**기존(최단) 항로**와 **AI 추천(회피) 항로**를 지도 위에서 비교합니다.

- 전 세계 항구 약 8천 곳 사이의 항로 계산 (운하·해협 통과, 날짜변경선 횡단 포함)
- 고래·바다거북·물범·해파리·부착 생물 등 분류군별 민감 구역 표시
- 아두이노 센서(수온·소음)를 Web Serial로 연결해 실시간 반영
- 서버 없이 동작하는 정적 사이트. 브라우저 또는 Windows 실행파일로 실행

---

## 빠르게 시작하기

```bash
python serve.py          # 포트를 바꾸려면 python serve.py 5000
```

브라우저에서 <http://localhost:8000> 을 엽니다.

- ES 모듈을 쓰기 때문에 `index.html`을 더블클릭해서 열면 동작하지 않습니다. 꼭 서버로 여세요.
- 주소는 `localhost`로 열어야 합니다. `127.0.0.1`이나 PC IP 주소로 열면 아두이노 연결이 되지 않습니다.
- 아두이노 연결(Web Serial)은 PC의 Chrome·Edge에서만 됩니다.

### Windows 앱

`desktop/` 폴더는 같은 `public/` 폴더를 Electron으로 감싼 데스크톱 앱입니다. Node.js가 필요합니다.

```powershell
cd desktop
npm ci
npm start          # 바로 실행
npm run dist       # 설치 없는 실행파일 → desktop/dist/SAFE-Route-<버전>.exe
```

앱 안에서도 아두이노 연결이 동작하며, 포트 선택 창이 뜹니다.

---

## 사용법

1. **항구 선택**: 출발·도착 항구를 이름, 나라, UN/LOCODE로 검색합니다. 지도 위 항구를 눌러 "출발로/도착으로"를 고를 수도 있고, ⇄ 버튼으로 바꿀 수 있습니다.
2. **즐겨찾기**: 자주 쓰는 항로를 최대 5개까지 저장합니다(브라우저·앱에 보관). 처음에는 포항→울릉, 부산→로테르담 등 예시 항로가 들어 있습니다.
3. **생물 데이터**: 기본은 OBIS 보호 대상 데이터입니다. "CSV 불러오기"로 직접 가진 데이터를 쓰거나 "예시 데이터"(가상 값)로 동작을 확인할 수 있습니다. 분류군별로 켜고 끌 수 있습니다.
4. **환경 조건**: 수온, 선박 소음, 산란 적정 수온, 회피 가중치를 슬라이더로 바꾸거나 아두이노에서 받아옵니다. 값을 바꾸면 바로 다시 계산합니다.
5. **항로 비교**: 분석 패널에서 두 항로의 총 거리, 민감 구역 통과 거리, 노출량을 표·막대·요약 문장으로 비교합니다.

지도는 확대·이동이 가능하고, "전 세계 위험도"와 "기록 점 보기"를 켜고 끌 수 있습니다. 오른쪽 위에서 다크 모드를 켤 수 있습니다.

---

## 계산 방법

### 0단계 · 해역 정하기 (`model/routing.js`)

전 세계를 촘촘한 격자 하나로 덮으면 칸이 수억 개라서 두 단계로 나눕니다.

1. **전 세계 0.25° 격자**(약 28 km 칸)에서 두 항구 사이의 대략적인 최단 길을 찾습니다. 동쪽 끝과 서쪽 끝이 이어져 있어 태평양 횡단 항로도 날짜변경선을 넘어갑니다.
2. 그 길 주변 **통로**(반경 50~150 km)만 0.01~0.15° 격자로 다시 나눠 그 안에서 두 항로를 찾습니다. 항로가 짧을수록 격자가 촘촘합니다(포항→울릉 0.01°, 부산→로테르담 약 0.1°).

보정 규칙:

- 수에즈·파나마·킬 운하와 보스포루스·지브롤터·싱가포르 등 좁은 해협은 `config.js`의 `PASSAGES` 선을 따라 바다로 뚫어 둡니다.
- 결빙되는 북극해는 대서양 쪽(그린란드~바렌츠해)만 열어 둡니다(`ARCTIC_ICE`). 이게 없으면 부산→로테르담이 북극 항로로 나옵니다.
- 1단계 격자는 칸이 커서 코린트 지협 같은 좁은 육지를 바다로 볼 때가 있습니다. 2단계 통로가 끊기면 끊긴 곳을 막고 1단계를 다시 찾습니다.
- 항구 좌표가 육지나 좁은 만 안에 있으면 가장 가까운, 서로 이어진 바다 칸에서 출발합니다(지도에 점선으로 표시).
- 500 km보다 짧은 항로는 직선을 먼저 시도합니다.

### 1단계 · 서식 밀도 (`model/density.js`)

출현 기록을 가우시안 커널(반경 약 7.5 km, 격자 자료는 칸 크기만큼 넓힘)로 퍼뜨려 서식 밀도를 추정합니다.

- 기록 수가 n인 칸의 무게는 `1 + ln(n)`입니다. 조사를 많이 한 곳이 나머지를 덮지 않게 하기 위해서입니다.
- **분류군별 정규화**: 분류군마다 밀도를 따로 0~1로 맞춘 뒤 칸마다 가장 큰 값을 씁니다. 기록이 수백 건인 따개비가 몇 건뿐인 물범을 덮지 않게 합니다.

### 2단계 · 위험도

```
위험도 = 서식 밀도 × (0.4 + 0.6 × e^−((수온 − 산란 적정 수온) / 5)²)
```

수온이 적정 수온과 같으면 서식 밀도가 그대로 위험도가 되고, 멀어질수록 최대 60%까지 낮아집니다.
위험도 0.5 이상인 칸을 **민감 구역**으로 봅니다(`HIGH_RISK`).

### 3단계 · 항로 탐색 (`model/pathfinding.js`)

A* 탐색으로 비용이 가장 작은 길을 찾습니다.

```
비용   = 거리 × (1 + 가중치 × 회피 비용)
가중치 = 회피 가중치 × (0.5 + 1.5 × 소음 비율)
```

회피 비용은 위험도에 민감 구역 통과 벌점 16을 더하고, 위험도 0.3~0.5 구간에는 최대 3의 완충 비용을 줍니다. 가중치가 0이면 최단 항로를 그대로 씁니다.
격자 오차로 AI 항로가 최단 항로보다 짧거나 민감 구역을 더 지나가게 나오면 최단 항로로 대체합니다.

### 비교 지표

| 지표 | 의미 |
| --- | --- |
| 총 거리 | 항로 길이 (km) |
| 민감 구역 통과 거리 | 위험도 0.5 이상인 칸을 지나는 거리 (km) |
| 노출량 | Σ(위험도 × 거리) |

### 성능

계산은 Web Worker(`route-worker.js`)에서 돌아 화면이 멈추지 않습니다. `compute-client.js`가 요청을 줄 세우고, 슬라이더를 빠르게 움직이는 등 입력이 연달아 들어오면 지난 요청은 버리고 최신 값만 계산합니다.

---

## 생물 데이터

앱은 시작할 때 미리 받아 둔 `public/data/obis_targets.json`(전 세계 약 1.4° 격자의 기록 수)으로 계산합니다.
항로가 정해지면 그 해역만 OBIS API에서 촘촘한 격자(좁은 해역은 약 5 km, 넓은 해역은 약 20~40 km 칸)로 다시 받아 재계산합니다. 대양 횡단처럼 해역이 아주 넓으면 기본 격자를 그대로 씁니다.

| 화면 이름 | OBIS 학명 | 포함되는 생물 |
| --- | --- | --- |
| 대형 해파리 | Scyphozoa | 해파리강 (노무라입깃해파리, 보름달물해파리류 등) |
| 부착 생물 | Ciona, Cirripedia | 유령멍게속, 따개비류 |
| 고래·돌고래류 | Cetacea | 고래목 전체 |
| 바다거북 | Chelonioidea | 바다거북과, 장수거북과 |
| 물범·물개 | Phocidae, Otariidae | 물범과, 물개과 |

처리 규칙:

- **중복 제거**: 같은 종·같은 지점(약 10 m)·같은 해의 기록은 하나로 칩니다.
- **해안 기록**: 해안선이 단순화돼 있어 갯바위·항구 기록이 육지 칸에 떨어지는 경우가 많습니다. 바다에서 3칸(약 6 km) 안쪽 기록은 버리지 않고 씁니다.
- **한계**: OBIS 기록은 조사한 곳에만 남습니다. 기록이 없는 곳이 생물이 없는 곳은 아닙니다.

### CSV 형식

위도·경도 열만 있으면 됩니다. `group` 열이 있으면 분류군별로 나눠 계산합니다.

```csv
decimalLatitude,decimalLongitude,group
37.48,130.90,고래·돌고래류
36.10,129.55,바다거북
```

열 이름은 `decimalLatitude`/`decimalLongitude` 대신 `위도`/`경도`도 됩니다.

---

## 아두이노 센서

Arduino Uno에 수온 센서와 소리 센서를 연결해 환경 조건을 실시간으로 보냅니다. 스케치는 `public/arduino/safe_route_sensor.ino`에 있고, 페이지의 "아두이노 연결 방법과 스케치"에서 보고 복사할 수 있습니다.

| 부품 | 핀 |
| --- | --- |
| DS18B20 수온 센서 (DATA) | D2 |
| 소리 센서 (AO) | A0 |

- 필요한 라이브러리: `OneWire`, `DallasTemperature`
- 9600 baud로 1초 안팎마다 `T:<수온>,N:<소음 0~100>` 형식으로 보냅니다. 예: `T:14.5,N:62`
- 소음은 0.2초 동안 잰 진폭을 `NOISE_MAX`(기본 300) 기준으로 0~100%로 바꾼 값입니다. 센서에 맞게 조정하세요.

---

## 폴더 구조

```
SAFE_Route/
├── serve.py                  로컬 개발 서버
├── firebase.json             Firebase Hosting 설정 (public/ 배포)
├── CONTRIBUTING.md           팀 협업 규칙
├── desktop/                  Windows 앱 (Electron)
│   ├── main.cjs                  public/을 safe://app 으로 열고 시리얼 포트 선택 처리
│   └── package.json              npm start / npm run dist
├── tools/                    데이터 생성 스크립트 (표준 라이브러리만 사용)
│   ├── build_world_data.py       해안선·항구 → public/data/world/
│   └── fetch_obis_targets.py     OBIS 보호 대상 격자 → public/data/obis_targets.json
└── public/                   배포되는 파일은 전부 여기
    ├── index.html
    ├── css/style.css
    ├── arduino/safe_route_sensor.ino
    ├── data/
    │   ├── world/land.json       육지 다각형 (Natural Earth 1:10m)
    │   ├── world/ports.json      항구 약 8천 곳 (UN/LOCODE + Natural Earth)
    │   └── obis_targets.json     보호 대상 생물 기록 수, 전 세계 약 1.4° 격자
    └── js/
        ├── main.js               진입점: 화면 요소와 계산 연결, 즐겨찾기
        ├── compute-client.js     워커 요청 관리 (최신 입력만 계산)
        ├── route-worker.js       무거운 계산을 담당하는 Web Worker
        ├── model/                순수 계산 (DOM 없음, Node로 테스트 가능)
        │   ├── config.js             상수: 격자 크기, 통로 반경, 운하·해협, 기본 항로
        │   ├── geo.js                대권 거리, 날짜변경선 경도 처리
        │   ├── grid.js               위도·경도 격자, 바다 영역 번호 매기기
        │   ├── land.js               육지 다각형 → 격자, 전 세계 0.25° 격자
        │   ├── ports.js              항구 목록과 검색
        │   ├── occurrences.js        출현 기록: OBIS(기본 + 해역별 상세), CSV, 예시 데이터
        │   ├── density.js            1·2단계: 커널 밀도 추정, 수온 보정 위험도
        │   ├── pathfinding.js        3단계: A* 탐색
        │   └── routing.js            해역 정하기, 두 항로 계산과 지표 측정
        └── ui/                   화면
            ├── map-view.js           캔버스 해도 (메르카토르, 확대·이동)
            ├── port-picker.js        항구 검색 상자
            ├── results.js            항로 비교 표·막대·요약 문장
            └── arduino.js            Web Serial로 센서 값 읽기
```

수식이나 상수를 바꾸려면 `public/js/model/`만 보면 됩니다. 화면 코드(`document`, `window`)는 `public/js/ui/`에만 둡니다.

---

## 데이터 다시 만들기

```bash
python tools/build_world_data.py     # 해안선·항구 (원본은 tools/.cache/에 보관)
python tools/fetch_obis_targets.py   # OBIS 보호 대상 전 세계 격자
```

- 한국어로 보일 항구 이름은 `build_world_data.py`의 `KO_NAMES`, 좌표가 없는 주요 항구는 `MANUAL_COORDS`에 추가합니다.
- 대상 생물을 바꾸려면 `fetch_obis_targets.py`의 `TARGET_GROUPS`를 고친 뒤 실행합니다.
- `public/data/`의 JSON은 손으로 고치지 말고 스크립트로만 만듭니다. 파일이 크기 때문에 다시 만들기 전에 팀에 먼저 알려 주세요.

---

## 배포 (Firebase Hosting)

서버 쪽 코드가 없는 정적 사이트라 무료(Spark) 요금제로 충분합니다.

```bash
npm install -g firebase-tools     # 처음 한 번
firebase login
firebase use --add                # 프로젝트 선택 → .firebaserc 생성

firebase emulators:start --only hosting   # 배포 전 확인 (선택)
firebase deploy --only hosting            # https://<프로젝트ID>.web.app
```

HTTPS 주소라서 배포된 사이트에서도 아두이노 연결이 동작합니다.

---

## 참여하기

브랜치·PR 규칙, 커밋 메시지, 조심할 파일은 [CONTRIBUTING.md](CONTRIBUTING.md)를 보세요.

## 데이터 출처

- 생물 출현 기록: [OBIS](https://obis.org) (Ocean Biodiversity Information System)
- 해안선·항구: [Natural Earth](https://www.naturalearthdata.com), [UN/LOCODE](https://unece.org/trade/cefact/unlocode-code-list-country-and-territory)
