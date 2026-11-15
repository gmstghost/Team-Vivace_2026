# 공지사항

## 꼭 지킬 것 4가지

1. **`main`에 바로 push 안 함.** 브랜치 만들어서 작업하고 PR로 올림
2. **작업 시작 전에 `git pull` 먼저 함.** 안 하면 충돌 남
3. **`git push --force` 금지임.** 다른 사람 작업이 날아감
4. **올리기 전에 로컬에서 한 번 돌려 봄.** 화면이 안 뜨는 코드는 올리면 안 됨

## 처음 세팅

```bash
git clone https://github.com/gmstghost/Team-Vivace_2026.git
cd Team-Vivace_2026
python serve.py
```

브라우저에서 <http://localhost:8000> 열면 됨

- `index.html` 더블클릭으로 열면 안 돌아감. 꼭 `python serve.py`로 열어야 함
- 주소는 `localhost`로 써야 함. `127.0.0.1`로 열면 아두이노 연결이 안 됨
- 아두이노 연결은 PC의 Chrome이나 Edge에서만 됨

## 작업 순서

```bash
git switch main
git pull                          # 최신 상태로 맞추기
git switch -c feature/항구-검색    # 브랜치 만들기
# ... 작업 ...
git add 고친파일
git commit -m "항구 검색에 한글 초성 검색 추가"
git push -u origin feature/항구-검색
```

그다음 GitHub에서 PR 열고 단톡에 알림. 다른 사람 한 명이 확인하면 합침

- 브랜치 이름은 `feature/기능이름`, `fix/버그이름` 식으로 지음
- 브랜치 하나에는 한 가지 일만 담음. 이것저것 섞이면 확인하기 힘듦
- 같은 파일을 여러 명이 동시에 고치면 충돌 나고 복구 귀찮음
- 충돌 났는데 어떻게 풀지 모르겠으면 억지로 풀지 말고 물어보면 됨

## 커밋 메시지

뭘 바꿨는지 한 줄로 씀 (한국어 O)

- 좋은 예: `수에즈 운하 통로 좌표 수정`, `결과 표에 연료 절감량 추가`
- 나쁜 예: `수정`, `asdf`, `진짜 최종`

`1.2.0` 같은 버전 번호 커밋은 gmstghost가 `main`에서 릴리스할 때만 씀

## 건드릴 때 조심할 파일

| 파일 | 주의할 점 |
| --- | --- |
| `public/data/` 안의 JSON | 손으로 고치면 안 됨. `tools/` 스크립트가 만드는 파일임. 바꾸려면 스크립트를 고치고 다시 돌려야 함 |
| `public/js/model/config.js` | 상수 하나 바꾸면 항로 결과가 전부 달라짐. 바꾸면 PR에 이유를 적어야 함 |
| `public/js/model/` 전체 | 계산만 하는 곳임. `document`나 `window` 같은 화면 코드는 여기 말고 `public/js/ui/`에 넣음 |
| `firebase.json`, `serve.py` | 배포랑 서버 설정이라 바꾸기 전에 먼저 말해야 함 |

데이터 스크립트(`tools/build_world_data.py`, `tools/fetch_obis_targets.py`)를 다시 돌리면 큰 파일이 통째로 바뀜   
두 명이 동시에 돌리면 충돌을 못 푸니까 돌리기 전에 디코에 꼭 말해야 함

## PR 올리기 전 확인

- [ ] `python serve.py`로 열었을 때 화면이 잘 뜸
- [ ] F12 콘솔에 빨간 에러가 없음
- [ ] 포항→울릉 같은 짧은 항로 하나, 부산→로테르담 같은 긴 항로 하나를 계산해 봄
- [ ] 내가 안 건드린 파일이 커밋에 안 섞여 있음 (`git status`로 확인)

## 올리면 안 되는 것

- 비밀번호, API 키, Firebase 로그인 정보
- `.venv/`, `__pycache__/`, `tools/.cache/` (`.gitignore`에 이미 들어 있음)
- 개인 메모나 테스트하다 만든 임시 파일

## 배포

배포 관련된 상세사항 안 정함 (안할수도 있음)
`firebase deploy`는 나만 함 (아직 안함)   
`main`에 합쳐졌다고 배포 사이트에 바로 반영되는 건 아님
## 막히면

디코 아니면 클로드에 물어보면 됨   
에러 메시지 캡처랑 뭘 하다 그랬는지 같이 올리면 빨리 풀림
