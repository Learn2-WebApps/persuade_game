# Persuade Game (설득 게임)

시나리오 기반 설득 훈련 게임. AI 캐릭터를 상대로 설득 게이지(0~100)를 올려 스테이지를 클리어한다.

## 프로젝트 구조

```
index.html               Vite 진입 HTML (학습자 게임)
admin.html               관리자 페이지 진입 HTML (/admin)
src/
  main.js                앱 진입점 + 화면 전환 총괄 (Entry → 오프닝 → TrackSelect ⇄ StageMap → Play → 리포트 → 아웃트로 → 종료)
  cutscene/              서점 액자 스토리 컷신 (플레이어·대본·조사 처리)
  ending/endingScreen.js 아웃트로 이후 종료 화면
  briefing/              스테이지 진입 시 상황 브리핑 화면 (START 전까지 대화 시작 안 함)
  style.css              전체 스타일 (비주얼 노벨 / 파스텔 오피스 톤)
  common/firebase.js     Firebase 웹 SDK 초기화 + Firestore 읽기/쓰기 헬퍼 (모두 트랙 단위)
  common/tracks.js       트랙 정의 + 트랙별 서브컬렉션 이름 규칙 (학습자·관리자 공용)
  common/session.js      입장 정보·선택한 트랙 sessionStorage 보관 (새로고침 이어하기)
  entry/entryScreen.js   입장 화면 (코드/이름/소속 → 이어하기 or 새 플레이어)
  track/trackSelectScreen.js  트랙 선택 허브 (일상/업무 카드 + 진행상황 + 리포트 다시 보기 + 게임 마치기)
  map/stageMapScreen.js  스테이지 선택 맵 (잠금/진행/실시간 activeRounds)
  play/playScreen.js     대화 화면 로직 (비주얼노벨 레이아웃 + 타이핑 효과)
  play/playScreen.css    대화 화면 전용 스타일
  play/assets.js         배경·캐릭터 에셋 경로 규칙 (교체는 이 규칙대로 파일만 넣으면 됨)
  play/demoStage.js      Firestore 읽기 실패 시 폴백용 내장 데모 데이터
  report/reportScreen.js 최종 설득 분석 리포트 화면
  admin/adminMain.js     관리자 로그인 + 진입점
  admin/adminDashboard.js 관리자 대시보드 (방 관리·설정·모니터링·CSV)
  admin/adminFirestore.js 관리자용 Firestore 헬퍼 (마스터 복사, 실시간 구독 등)
  admin/adminApi.js      관리자 인증 상태 보관 + 관리자 전용 서버 API 호출 (방 삭제)
  admin/adminStyle.css   대시보드 스타일
functions/api/           Cloudflare Pages Functions (score, report, admin-auth, admin-delete-room)
functions/_lib/adminAuth.js 관리자 비밀번호 검증 (함수 공용)
functions/_lib/gcp.js    함수 공용 헬퍼 (Firestore REST 인증·조회, Gemini 호출)
scripts/                 Firestore 시드·개발 편의 스크립트
  stageData.js           트랙별 시나리오(work/life) + 기본 settings (공용 데이터)
  seed.js                데모 룸(DEMO01) 시드
  seed-master.js         트랙별 마스터 템플릿(templates/work, templates/life) 시드
public/                  정적 에셋 (빌드 시 그대로 복사됨)
```

## UI / 에셋 메모

- 비주얼 노벨 톤: 파스텔 그라데이션 배경 + 구름/떠다니는 하트·반짝이(CSS 애니메이션), 둥근 카드, Pretendard 웹폰트(CDN).
  `prefers-reduced-motion` 설정 시 장식 애니메이션은 자동으로 꺼진다.

## 서점 액자 스토리 (오프닝 / 아웃트로 컷신)

게임 전체를 "설득의 정석"이라는 책을 펼치는 이야기로 감싼다.

```
입장 → [오프닝 컷신] → 트랙 선택("어떤 이야기를 펼칠까?") → 스테이지 5개 플레이
     → 트랙 완료 시 자동으로 설득 리포트 → [트랙 선택으로 돌아가기]
     → (남은 트랙 플레이 / 완료 트랙 리포트 다시 보기 / [게임 마치기])
     → [게임 마치기] → [아웃트로 컷신] → 종료 화면
```

- **오프닝**(5장면): 손해만 보고 돌아가던 길 → 낯선 골목 → 서점 → 책 표지 → 책 속으로.
  방·플레이어 단위로 **1회만** 재생된다 (기록은 sessionStorage — 탭을 닫으면 초기화).
- **아웃트로**(4장면): 다시 서점 → 노주인의 질문 → 여운 → "이 책, 얼마면 사겠나?"
  **트랙 선택 화면의 [게임 마치기]를 눌렀을 때만** 재생된다 — 두 트랙을 다 마쳐도 자동으로
  넘어가지 않는다. **마무리 시점은 학습자가 고른다** (한 트랙만 마쳐도 마칠 수 있다).
  끝나면 종료 화면(`src/ending/endingScreen.js`)으로 이어지고, 거기서 트랙 선택으로 돌아갈 수 있다.

> 아웃트로 마지막의 "책값 흥정"은 **여운을 주는 연출 대사까지만** 구현돼 있다.
> 실제 흥정 입력·채점은 없다 (추후 확장 여지).

**조작**: 화면 클릭 / `다음` → 다음 줄 (타이핑 중이면 그 줄 즉시 완성) ·
`건너뛰기` → 컷신 전체 스킵 · 키보드 `Enter`/`Space` = 다음, `Esc` = 건너뛰기.

### 파일

| 파일 | 역할 |
|---|---|
| `src/cutscene/cutsceneScreen.js` | 컷신 플레이어 (오프닝·아웃트로 공용) |
| `src/cutscene/cutsceneData.js` | 장면 대본 (`{ background, lines[], bgm }`) |
| `src/cutscene/josa.js` | 이름 받침에 따른 조사 자동 선택 + 대사 토큰 치환 |
| `src/cutscene/level.js` | 4축 누적 점수 → 설득 레벨·칭호·코멘트 (**현재 미사용** — 보관용) |
| `src/cutscene/cutscene.css` | 컷신 스타일 |
| `src/ending/endingScreen.js` | 아웃트로 이후 종료 화면 |

### 대사 토큰

대본에 아래 토큰을 쓰면 자동으로 치환된다.

| 토큰 | 결과 |
|---|---|
| `{학습자이름}` / `{이름}` | 입장 시 입력한 이름 |
| `{은/는}` `{이/가}` `{을/를}` `{과/와}` `{으로/로}` | **바로 앞 글자의 받침**에 맞는 조사 |

받침 판별은 한글 유니코드 계산 `(코드 - 0xAC00) % 28 === 0 → 받침 없음`을 쓴다.
예) `민준{은/는}` → "민준은", `지수{은/는}` → "지수는".
`{으로/로}`는 ㄹ받침도 '로'를 쓰도록 예외 처리돼 있다 (서울로).

### 설득 레벨 산출 (현재 미사용 — 보관용)

> 아웃트로 대본이 개편되면서 레벨 장면이 빠져, `src/cutscene/level.js`는 지금 어디서도
> 호출되지 않는다. 다시 넣고 싶으면 `computePersuasionLevel()` 결과를 컷신
> `vars({ level, title, comment })`로 넘기고 대본에 해당 토큰을 쓰면 된다.

이미 저장된 `stageResults_{track}/*.turns[].axisScores`만 읽어서 요약한다
(**채점 로직은 건드리지 않는다**).

1. 두 트랙 전체 턴의 축별 점수를 누적
2. **턴당 평균**(누적 총점 ÷ 턴 수)으로 레벨 판정 — 누적 합만 쓰면 말을 많이 할수록
   레벨이 올라가므로 턴 수로 정규화한다
3. 누적이 가장 높은 축 = 강점, 가장 낮은 축 = 약점 → 코멘트 생성

| 턴당 평균 | 레벨 | 칭호 |
|---|---|---|
| 12 이상 | LV.5 | 설득의 왕 |
| 8~11 | LV.4 | 마음을 여는 사람 |
| 4~7 | LV.3 | 대화를 이끄는 사람 |
| 0~3 | LV.2 | 한 걸음 나아간 사람 |
| 0 미만 | LV.1 | 이제 막 책을 편 사람 |

> 축 점수가 전부 같으면(예: 채점이 폴백으로 처리돼 전부 0) 강점·약점을 단정하지 않고
> 중립 코멘트를 쓴다. 대화 기록이 아예 없으면 `LV.?`로 표시한다.

### 🎬 컷신 에셋 교체

`public/assets/cutscene/` 아래에 아래 이름으로 넣으면 코드 수정 없이 표시된다.
**파일이 없어도 컷신은 끝까지 재생된다** — 배경은 장면별 그라데이션으로 대체되고
인물은 표시가 생략되며, 깨진 이미지 아이콘은 뜨지 않는다.

화면은 **배경 → 인물 → 대사 박스** 세 겹으로 쌓인다.

**배경** (화면 전체를 덮음 / `cover`) — 가로형 **JPEG**. 현재 에셋은 1376×768.

| 파일 | 장면 |
|---|---|
| `street.jpg` | 오프닝1 — 어두운 저녁 거리 |
| `alley.jpg` | 오프닝2 — 낯선 골목 |
| `bookstore.jpg` | 오프닝3 — 서점 내부 |
| `book_cover.jpg` | 오프닝4 — 책 표지 클로즈업 |
| `book_open.jpg` | 오프닝5 / 아웃트로3 — 책 펼침·빛 |
| `bookstore_night.jpg` | 아웃트로1·2·4 — 노을 진 서점 |

> 배경은 **사진형이라 JPEG로 넣는다** (quality 85 기준 장당 0.1~0.2MB).
> PNG로 넣으면 같은 화질에 10배 커진다 — 첫 컷신 로딩이 그만큼 느려진다.
> 확장자만 바꾸지 말고 **실제로 JPEG로 인코딩**할 것.

**인물** (배경 위에 얹는 레이어 / `contain`, 하단 중앙 정렬) — **배경이 비치는 투명 PNG** 필수
(JPEG는 투명도를 지원하지 않으므로 인물은 반드시 PNG)

| 파일 | 장면 |
|---|---|
| `owner.png` | 오프닝3 / 아웃트로2·4 — 노주인 (표정 분기 없이 하나로 통일) |

> 인물은 세로로 긴 이미지가 자연스럽다(권장 1000×1400 내외, 인물 아랫단이 이미지 바닥에 닿게).
> 대사 박스에 가리지 않도록 화면 하단 약 190px을 비워 배치한다.

장면 대사·순서를 바꾸려면 `src/cutscene/cutsceneData.js`만 고치면 된다.
`background`를 비우면 **이전 장면의 배경을 그대로 유지**하지만,
`character`는 반대로 **비우면 인물이 사라진다** (장면이 바뀐 걸 알아채게 하려는 의도).

> 대본의 **한 줄 = 한 번의 타이핑 단위**다. 문장을 너무 잘게 쪼개면 화면이 툭툭 끊기므로
> 의미가 이어지는 부분은 한 줄로 합쳐 쓴다.

## 상황 브리핑 화면 (대화 시작 전)

스테이지를 고르면 **대화가 바로 시작되지 않는다.** 먼저 브리핑 화면이 뜨고,
**[START]를 눌러야** 대화가 시작된다 (그전까지 채점·게이지·타이머는 돌지 않는다).

```
스테이지 맵 → [카드 클릭] → 상황 브리핑 → [START] → 대화(Play)
                                └ [← 스테이지 맵] 으로 되돌아갈 수도 있다
```

**레이아웃**: 배경(스테이지 배경) 위에 왼쪽 캐릭터(normal 표정 + 이름·직책),
오른쪽 카드에 `🎬 상황` → `🎯 나의 목표` → `💡 설득의 조언` 3블록, 하단 중앙 [START].
상단에 "📖 책장을 넘기자…" 도입 문구로 서점 액자 톤을 잇는다.

### 브리핑 데이터 필드

`scripts/stageData.js`의 각 스테이지에 3개 필드가 있다 (work 5 + life 5 전부).

| 필드 | 용도 |
|---|---|
| `situationBrief` | 지금 어떤 상황인지, 상대는 어떤 상태인지 |
| `goalBrief` | 이 대화에서 무엇을 이끌어내야 하는지 (정답을 직접 알려주지 않는 선) |
| `persuasionTip` | 이 상황에 효과적인 접근 (4축 중 핵심을 **쉬운 말로** — 학술용어 노출 금지) |

- 기존 `situation`(채점 프롬프트용 상세 서술)은 **그대로 둔다.**
  `situationBrief`는 학습자에게 보여줄 짧은 버전으로 **병기**한다.
- 필드가 없는 스테이지는 `situation` / `persuasionGoal`로 자동 대체되므로 화면이 비지 않는다.

> ⚠️ **브리핑 텍스트는 방 생성 시점에 복사된다.** 이 필드가 추가되기 전에 만든 방은
> 대체 텍스트가 뜬다. 새 브리핑을 보려면 `npm run seed:master -- --force` 후
> **방을 새로 만들어야** 한다.

### 파일

| 파일 | 역할 |
|---|---|
| `src/briefing/briefingScreen.js` | 브리핑 화면 (배경·캐릭터 에셋은 대화 화면과 같은 슬롯 규칙 사용) |
| `src/briefing/briefing.css` | 브리핑 스타일 |

## 대화 화면 (비주얼노벨 레이아웃)

대화 화면(`src/play/playScreen.js` + `playScreen.css`)은 미연시/비주얼노벨 구조다.

```
┌──────────────────────────────────────────────┐
│ 💗 02 | 스테이지 제목        EP.01~05 (육각) │  ← 좌상단 챕터 / 우상단 진행
│                              💗 [게이지] 68  │     게이지(85 기준선) + 타이머
│                                    ⏱ 04:12  │
│                                              │
│                 [ 캐릭터 ]                   │  ← 감정별 이미지 크로스페이드
│                                              │
│ ┌ 정 부장 ─────────────────────────────────┐ │
│ │ 대사가 한 글자씩 타이핑됩니다…        ▼ │ │  ← 클릭 시 타이핑 즉시 완성
│ └──────────────────────────────────────────┘ │
│ [ 당신의 대답을 입력하세요…    ] [ 💌 SEND ] │
│  3/15                          대화 마치기   │
└──────────────────────────────────────────────┘
```

- 감정(happy/normal/worry/angry) 판정은 **기존 게이지 임계값 로직 그대로**이고, 표시만 이미지로 바뀐다.
  감정이 바뀌면 `<img class="vn-char">` 두 장이 서로 페이드된다.
- 대사는 타이핑 효과로 나타나고, 대사창을 클릭하면 즉시 완성된다.
- 반응형: 데스크톱 가로형 기준. 폭이 좁아지면 HUD가 2줄로 나뉘고,
  **≤560px에서는 EP 육각 노드를 접는다**(현재 화수는 좌상단 챕터 pill의 숫자가 대신 알려줌).

### 🎨 에셋 교체 방법

에셋 경로 규칙은 `src/play/assets.js` 한 곳에 있다.
**파일을 규칙대로 `public/assets/` 아래에 넣기만 하면 코드 수정 없이 자동으로 표시된다.**
(Vite가 `public/`을 그대로 서빙하므로 빌드 설정을 건드릴 필요 없다.)

| 종류 | 경로 | 규격 |
|---|---|---|
| 배경 | `public/assets/{track}/bg/{stageId}.jpg` | **1920×1080 가로형**, `object-fit: cover`로 화면을 채움 |
| 캐릭터 | `public/assets/{track}/{characterKey}/{emotion}.png` | **투명 PNG 세로형** (권장 600×1200 내외) |

- `track` = `work` | `life`
- `stageId` = `stage1` ~ `stage5`
- `emotion` = `happy` | `normal` | `worry` | `angry` (4개 모두 필요)
- `characterKey` = `stageData.js`의 `assetMap` 경로에 들어 있는 폴더명 그대로

```
public/assets/
├─ work/
│  ├─ bg/          stage1.jpg … stage5.jpg
│  ├─ jimin/       happy.png normal.png worry.png angry.png
│  ├─ boojang/     …
│  ├─ kimteam/     …
│  ├─ ceo/         …
│  └─ team/        …
└─ life/
   ├─ bg/          stage1.jpg … stage5.jpg
   ├─ mom/  friend/  partner/  seller/  roommate/
```

**경로 우선순위** (앞의 것이 있으면 그것을 씀):
- 배경: 스테이지의 `background` 필드 → `backgroundImage` 필드 → 위 규칙 경로
- 캐릭터: 스테이지의 `assetMap[emotion]` → `characterKey` 기반 규칙 경로

> 파일이 없으면 **플레이스홀더로 자동 폴백**한다 (그라데이션 배경 + 감정별로 색이 바뀌는 실루엣).
> 깨진 이미지 아이콘은 뜨지 않으므로, 에셋을 하나씩 채워 넣어도 화면이 망가지지 않는다.
> 콘솔에 `[play] 배경 에셋 없음(플레이스홀더 사용): …` 로 어떤 경로를 찾고 있었는지 찍힌다.

## 게임 흐름과 데이터

```
입장(코드/이름/소속) → 트랙 선택 → 스테이지 맵 → 대화 플레이 → 점수 저장 → 맵 복귀
                                                  └ 트랙의 마지막 스테이지였다면 → 설득 리포트 → 트랙 선택
```

**트랙 고정**: 트랙을 골라 스테이지에 들어가면, 그 트랙을 다 풀기 전까지 다른 트랙으로 갈 수 없다.
맵에는 트랙을 벗어나는 버튼이 없다(옛 "🔄 트랙 바꾸기" 버튼은 제거됨). 트랙을 마치면
리포트를 거쳐 트랙 선택 화면으로 돌아온다.
`session.track`은 트랙 선택 화면에 들어설 때 비워지므로, 허브에서 새로고침해도 허브로 돌아온다
(플레이 중 새로고침은 `track`이 남아 있어 맵으로 이어진다).

- **playerId**: 이름+소속을 정규화한 문자열 (`영업1팀__홍길동` 형태) → 재입장 시 같은 문서로 이어하기
- **잠금 로직**: stage1 항상 열림 → 이전 스테이지 완료 시 다음 열림 → 단 `settings.activeRounds`까지만 (초과분은 "준비 중")
- **activeRounds는 onSnapshot 실시간 구독** — 관리자가 값을 바꾸면 맵의 잠금 상태가 즉시 갱신됨 (플레이 중인 화면은 방해하지 않음)
- **점수 정책** (바꾸려면 `src/common/firebase.js`의 `saveStageResult` 주석 참고):
  - 재플레이: 최신 점수로 덮어쓰기
  - totalScore: 스테이지 점수 합계
- 플레이어 데이터 구조:

```
rooms/{roomCode}/players/{playerId}
  name, affiliation, enteredAt, lastActiveAt, status
  totalScore                      ← 두 트랙 합계
  progress: { work: { totalScore, currentMaxStageOrder, status }, life: {...} }
  finalReports: { work: {...}, life: {...} }, finalReportAt: { work, life }
  stageResults_work/{stageId}, stageResults_life/{stageId}:
    stageScore, turnCount, completedAt,
    turns[{ userMessage, scoreDelta, axisScores{emotion,logic,trust,timing}, gaugeAfter, actionTags, characterReply, timestamp }]
```

자세한 트랙 구조는 아래 "트랙 (업무 / 일상)" 참고.

## 실행 방법

```bash
# 0. 사전 준비: .dev.vars 에 GEMINI_API_KEY 등 채우기 (아래 "API" 섹션 참고)
npm install
npm run dev
```

`npm run dev` 하나로 두 서버가 함께 뜬다:
- **web**: Vite 개발 서버 → http://localhost:5173
- **api**: wrangler pages dev → http://127.0.0.1:8788 (`/api/*`는 Vite가 여기로 프록시)

> **`wrangler.toml`의 `compatibility_date`는 반드시 고정해 둘 것.**
> 비워두면 wrangler가 "오늘 날짜"를 쓰는데, 설치된 workerd가 그 날짜를 아직 지원하지 않으면
> `The Workers runtime failed to start` 로 api 서버가 아예 뜨지 않는다.
> wrangler를 올린 뒤에만 이 날짜를 함께 올린다. (현재 고정값: `2026-07-15`)

**전체 흐름 테스트 순서**
1. http://localhost:5173 접속 → 입장 화면("설득의 정석")이 뜬다.
2. 코드 `DEMO01`, 이름/소속 입력 → "입장하기" → 스테이지 맵이 뜬다.
   - 처음이면 EP.01만 "도전하기", 나머지는 잠김/준비 중 상태.
3. EP.01 카드 클릭 → 대화 화면 진입 (게이지 50, 타이머 시작).
4. 말을 입력하며 게이지를 움직인 뒤 "대화 마치기" → 결과 화면에서 "점수가 저장되었어요" 확인 → "스테이지 맵으로".
5. 맵에서 EP.01에 점수 뱃지가 붙고 **EP.02가 열렸는지** 확인.
6. **새로고침(F5)** → 입장 화면을 건너뛰고 맵으로 바로 복귀(이어하기), 점수·진행 유지 확인.
7. 탭을 닫았다 다시 열어 같은 코드+이름+소속으로 입장 → 이전 진행을 그대로 불러오는지 확인.
8. (선택) Firebase 콘솔에서 `rooms/DEMO01`의 `settings.activeRounds`를 바꿔보면 맵의 "준비 중" 범위가 **실시간으로** 바뀐다.
9. 열린 스테이지를 모두 완료하면 "전체 완료" 배너와 "리포트 준비 중" 버튼(placeholder)이 표시된다.

## 최종 설득 분석 리포트

**트랙의 마지막 스테이지를 마치면 별도 조작 없이 그 트랙의 리포트로 이어진다**
(스테이지 결과 카드의 버튼이 "📊 설득 리포트 보기"로 바뀌고, 맵을 거치지 않는다).
이미 마친 트랙의 리포트는 트랙 선택 화면의 **[리포트 다시 보기]** 로 언제든 다시 열 수 있고,
맵의 "전체 완료" 배너 버튼으로도 열 수 있다. 리포트를 닫으면 **트랙 선택 화면**으로 돌아간다.

**동작 흐름**
1. 각 스테이지 종료 시 턴별 대화 로그가 저장된다:
   `stageResults/{stageId}.turns = [{ userMessage, scoreDelta, axisScores, gaugeAfter, actionTags, characterReply, timestamp }]`
2. 버튼 클릭 → `POST /api/report { roomCode, playerId }` → 서버가 모든 turns + 스테이지 맥락(숨은 니즈 등 정답 데이터는 **서버에서만** 사용)을 모아 Gemini(temperature 0.7, JSON 스키마 강제)로 분석.
3. 생성된 리포트는 `players/{playerId}.finalReport`에 저장 → **재조회 시 API 재호출 없이** 저장본 표시(비용 절감). "다시 분석하기" 버튼으로 재생성 가능.
4. 관리자 대시보드에서 참가자 행을 펼치면 등급·총평이 보이고 "리포트 전체 보기"로 상세를 펼칠 수 있다.

**리포트 모델**: `room.settings.reportModel` > 환경변수 `REPORT_MODEL` > 기본값 `gemini-3-flash-preview`

**리포트 테스트 순서**
1. `npm run dev` → 학습자로 입장해 열린 스테이지를 모두 완료 (관리자에서 activeRounds를 1~2로 줄이면 빠르게 테스트 가능).
2. 맵의 "📊 설득 리포트 보기" 클릭 → "분석 중..." 로딩 → 리포트 표시. **강점/아쉬운 점의 인용문이 내가 실제로 입력한 문장인지 확인.**
3. 맵으로 돌아갔다가 다시 리포트 열기 → 로딩 없이 저장본이 바로 뜨는지 확인 ("저장된 리포트예요" 안내 표시).
4. "🔄 다시 분석하기" → 새 리포트로 갱신되는지 확인.
5. 관리자 페이지 → 해당 참가자 행 펼치기 → 등급/총평 + 리포트 전체 보기 확인.

**샘플 리포트 (실제 생성 결과 발췌)**

```json
{
  "overallGrade": "A",
  "averageScore": 78,
  "summary": "상대의 숨은 니즈를 파악했을 때 매우 강력한 설득력을 발휘하며, 자신의 실수를 빠르게 인정하고 대화를 복구하는 회복 탄력성이 뛰어납니다. ...",
  "observedStyle": "주로 상대방의 요구사항을 구체적으로 수치화하여 제안하거나, 상대의 감정을 즉각적으로 인정하며 대화를 풀어나가는 방식을 사용합니다. ...",
  "strengths": [
    {
      "point": "상대의 심리적 부담을 덜어주는 구체적인 제안 능력",
      "evidence": "\"바쁘신 거 알아요. 딱 3분이면 됩니다. 지난달 보고서 파일 위치만 알려주시면 돼요.\"",
      "effect": "상대방에게 예측 가능성을 제공하여 심리적 장벽을 낮췄습니다 (점수 +15)."
    }
  ],
  "weaknesses": [
    {
      "point": "본인의 급박함을 앞세워 상대를 압박하는 화법",
      "evidence": "\"꼭 지금 알려주셔야 해요. 저 급하거든요.\"",
      "suggestion": "자신의 상황을 강조하기보다 상대의 배려에 호소하는 표현이 더 효과적입니다."
    }
  ],
  "recommendations": ["갈등 상황에서 해결책이나 규정을 언급하기 전, 상대방의 감정 상태를 먼저 읽어주는 '공감 선언'을 습관화해 보세요."],
  "closingComment": "실수를 인지하자마자 사과하며 페이스를 되찾는 모습이 매우 인상적이었습니다!",
  "stageScores": [{ "stageId": "stage1", "title": "바쁜 선배에게 5분 얻어내기", "order": 1, "score": 82 }]
}
```

> 주의: 리포트 이전에 플레이한 기록(turns 없이 점수만 저장된 스테이지)은 인용 없이 점수만 반영된다.
> 대화 기록이 하나도 없으면 400 에러("대화 기록이 없어...")를 반환하므로 해당 스테이지를 다시 플레이하면 된다.

## 관리자(강사) 페이지 — /admin

접속: 개발 시 http://localhost:5173/admin (배포 후에는 `https://도메인/admin`)
또는 입장 화면 **우측 상단의 "⚙ 관리자" 버튼** 클릭
(뷰포트 고정 pill 버튼 — 입장 폼이 화면 중앙이라 학습자 동선을 가리지 않는다.
좁은 화면(≤420px)에서는 아이콘만 남는다).

**로그인**: 아이디 + 비밀번호 2개를 입력한다. 개발 환경은 `.dev.vars`에
`ADMIN_ID=learn2` / `ADMIN_PASSWORD=0067`로 설정한다.

두 환경변수가 없을 때의 동작은 **`ENVIRONMENT` 값에 따라 갈린다** (`functions/_lib/adminAuth.js`):

| `ENVIRONMENT` | `ADMIN_ID`/`ADMIN_PASSWORD` 미설정 시 |
|---|---|
| `development` | 기본값 `learn2`/`0067`로 폴백 + 서버 콘솔 경고 (로컬 편의) |
| 그 외 (**값이 없는 경우 포함**) | 폴백 없이 **500** `관리자 자격증명이 서버에 설정되지 않았습니다.` |

즉 **기본값 폴백은 로컬에서만** 동작한다. `ENVIRONMENT`를 "development"라고 **명시**하지 않으면
프로덕션으로 간주하는 fail-closed 설계다 — 배포하며 변수 설정을 깜빡해도 공개된 기본
자격증명으로 관리자 페이지가 열리지 않게 하려는 것.

> ⚠️ **기본값은 이 저장소를 보는 사람 누구나 아는 값이다.** 배포 시에는 반드시
> Cloudflare Pages 대시보드에 `ADMIN_ID`·`ADMIN_PASSWORD`를 **Secret으로 등록**하고 다른 값을 쓸 것.
> 등록하지 않으면 관리자 API가 500으로 막혀 대시보드를 아예 쓸 수 없다.

`ENVIRONMENT`는 로컬은 `.dev.vars`에 `development`, 배포는 `wrangler.toml`의
`[env.production.vars]`(또는 Cloudflare 대시보드)에 `production`으로 둔다.
`.dev.vars`는 배포에 올라가지 않으므로 로컬 표시가 배포 환경으로 새지 않는다.
`wrangler.toml` 최상단에 `[vars] ENVIRONMENT = "development"`를 두면 배포까지 개발 모드가 되니 **금지**.

참고: 이 플래그는 **자격증명이 비어 있을 때만** 의미가 있다.
`ADMIN_ID`·`ADMIN_PASSWORD`가 제대로 설정돼 있으면 `ENVIRONMENT`가 무엇이든 정상 동작한다.

아이디와 비밀번호 중 무엇이 틀렸는지는 **구분해서 알려주지 않는다**
("아이디 또는 비밀번호가 올바르지 않습니다." 통합 메시지) — 어느 쪽이 맞았는지 흘리면
공격자가 아이디부터 확정할 수 있기 때문이다.

### 트랙 (업무 / 일상)

시나리오는 두 개의 **트랙**으로 나뉜다. 게임 로직(4축 채점·게이지·저장·실시간·리포트·UI)은
두 트랙이 100% 동일하고, **시나리오 내용만** 다르다.

| 트랙 키 | 표시명 | 내용 |
|---|---|---|
| `work` | 업무 설득 트랙 | 직장 상황 설득 5스테이지 |
| `life` | 일상 설득 트랙 | 생활 속 설득 5스테이지 |

**방 하나에 두 트랙이 모두 들어가고, 학습자가 입장 후 직접 고른다.**
(관리자는 트랙을 지정하지 않는다 — 새 방을 만들면 항상 두 트랙 다 복사된다.)

```
rooms/{code}
  tracks: ['work', 'life']
  settings { ... }                 ← 두 트랙 공통
  stages_work/stage1~5
  stages_life/stage1~5
  players/{playerId}
    totalScore                     ← 두 트랙 합계 (관리자 표 정렬용)
    progress: {                    ← 트랙별 진행상황, 서로 완전히 독립
      work: { totalScore, currentMaxStageOrder, status },
      life: { ... }
    }
    finalReports: { work: {...}, life: {...} }
    stageResults_work/{stageId}
    stageResults_life/{stageId}
```

- 트랙 정의·경로 규칙은 `src/common/tracks.js` 한 곳에 있다
  (`stagesCollection(track)`, `resultsCollection(track)`).
  서버 함수(`functions/api/*.js`)는 번들을 공유하지 않으므로 같은 규칙을 각자 상수로 갖고 있다 — 바꿀 때 함께 고칠 것.
- 업무 트랙 진행은 일상 트랙 잠금해제에 **영향을 주지 않는다.**
- 재입장 시 같은 `playerId`로 두 트랙 진행상황이 모두 복원된다.
- 리포트는 **트랙별로** 생성된다 (`/api/score`, `/api/report` 모두 `track` 파라미터 필수).

> ⚠️ **트랙 도입 이전(구조 A)에 만든 방은 호환되지 않는다.** 옛 방은 스테이지가 `stages/`에
> 들어 있어 새 코드가 찾지 못한다. 옛 방은 삭제하고 새로 만들 것 (아래 "옛 방 정리" 참고).

### 학습자 흐름

```
입장(코드+이름+소속) → [오프닝] → 트랙 선택 ⇄ 스테이지 맵 → 대화 플레이 → 점수 저장
                                    ↑                          └ 트랙 완료 → 설득 리포트 ┘
                                    └ [게임 마치기] → [아웃트로] → 종료 화면
```

- **트랙 선택 화면 = 게임의 허브.** 카드는 **일상(왼쪽) → 업무(오른쪽)** 순으로 놓여
  학습자가 일상 트랙을 먼저 접한다 (순서는 `TRACK_SELECT_ORDER`).
  각 카드에 이모지·"○○의 장"·한 줄 설명과 진행 상태(미시작/진행 중·점수/완료됨)를 보여준다.
- 허브에서 할 수 있는 일: **아직 안 푼 트랙 플레이 / 완료한 트랙 [리포트 다시 보기] / [게임 마치기]**.
- **[게임 마치기]는 한 트랙만 완료해도 활성화된다** (두 트랙 강제 아님). 누르면 아웃트로 → 종료 화면.
- 선택한 트랙은 sessionStorage 세션에 저장된다 → 플레이 중 새로고침 시 그 트랙의 맵으로 복귀.
  허브로 돌아오면 비워지므로, 허브에서 새로고침하면 허브로 돌아온다.

### 마스터 템플릿

새 방은 **선택한 트랙**의 마스터를 복사해 만들어진다. 최초 1회 마스터를 시드해야 한다:

```bash
npm run seed:master                  # templates/work + templates/life 둘 다 시드
npm run seed:master -- --force       # 확인 없이 덮어쓰기
npm run seed:master -- --track=life  # 한 트랙만 시드
```

시나리오 내용을 고치려면 `scripts/stageData.js` 수정 → `npm run seed:master -- --force` 재실행.
스테이지 데이터가 비어 있는 트랙은 시드에서 자동으로 건너뛴다.

> ⚠️ **재시드는 이미 만들어진 방에 소급 적용되지 않는다.** 방은 생성 시점의 복사본을 쓰므로,
> 시나리오를 고친 뒤에는 **방을 새로 만들어야** 바뀐 내용으로 플레이된다.
> 기존 방에서 테스트하면 예전 데이터가 그대로 나오니 주의.

### 옛 방 정리

시나리오를 갈아엎은 뒤 남아 있는 옛 방은 지워야 학습자가 예전 시나리오를 만나지 않는다.

**관리자 화면에서**: 방 목록의 각 방 오른쪽 **[🗑]** 버튼 → 확인 팝업 → 삭제.
`POST /api/admin-delete-room`이 관리자 비밀번호를 검증한 뒤 아래 스크립트와 **같은 순서로 재귀 삭제**하고,
끝나면 방 목록이 자동 갱신된다.

**터미널에서**:

```bash
npm run rooms:list                        # 방 목록 (코드·트랙·참가자 수·생성일)
npm run rooms:delete -- DEMO01 3YBV WXEZ  # 확인 후 삭제
npm run rooms:delete -- DEMO01 --force    # 확인 없이 삭제
```

`rooms/{코드}` 문서뿐 아니라 하위 `stages`, `players/{id}/stageResults`까지 재귀 삭제한다
(Firestore는 문서를 지워도 하위 컬렉션이 남으므로 반드시 이 스크립트를 쓸 것).

> ⚠️ 되돌릴 수 없다. 참가자 점수·대화 기록·리포트가 함께 사라지니 목록으로 먼저 확인할 것.

**입장 가능 여부는 `status`로 결정된다** — 입장 화면은 `closed`만 막는다.
따라서 `ready`, `open` 상태의 옛 방은 코드만 알면 학습자가 그대로 입장할 수 있다.
방을 남겨두되 입장만 막고 싶다면 관리자 화면에서 "닫힘"으로 토글하면 된다.

### persuasionGoal (설득 목표)

게이지 85를 넘겼을 때 캐릭터가 보일 **구체적인 승낙 반응**을 지시하는 필드다.
예: `"'그 정도 안전장치면… 한번 해봅시다'라고 조건부 수락하게 하기"`
채점 프롬프트가 이 문구를 그대로 받아 characterReply의 착지점으로 쓴다.

필드가 없으면 캐릭터명 기반 범용 문구로 폴백하므로 스테이지가 깨지지는 않지만,
승낙 장면이 밋밋해지니 **스테이지마다 채워두는 것을 권장**한다.

### 채점 4축 (두 트랙 공통)

모든 스테이지는 아래 4축을 **균등(각 25%)** 하게 채점한다. 기준은
`functions/api/score.js` 의 `SCORING_AXES` 한 곳에만 있다.

| 축 | 키 | 본다는 것 |
|---|---|---|
| 감정 읽기 | `emotion` | 상대의 감정·상태를 알아차리고 말로 인정했는가 |
| 논리·근거 | `logic` | 구체적 근거·대안·리스크 통제안을 제시했는가 |
| 신뢰 형성 | `trust` | 상대의 입장·기여·제약을 존중했는가 |
| 타이밍 | `timing` | 대화 흐름에 맞는 때에 꺼낸 말인가 |

채점 모델은 축별로 -5~+5를 매긴 뒤 동일 비중으로 합산해 `scoreDelta`(-15~+20)를 낸다.
축 점수는 응답의 `axisScores`로 돌아오고 `stageResults.turns[].axisScores`에 저장되어
최종 리포트의 분석 근거가 된다.

> **디브리핑 원칙**: 리포트에는 "에토스/파토스/로고스" 같은 학술 용어나 축 이름을
> **그대로 노출하지 않는다.** 대신 "감정을 먼저 읽어준 점이 효과적이었어요",
> "근거와 리스크 통제안을 제시한 점이 결정적이었어요"처럼 풀어서 설명한다.
> (`functions/api/report.js` 분석 지침 4-1)

#### scoringExamples 형식

`high` / `mid` / `low` 는 각각 **배열**이며, 항목은 `{ utterance, axes, reason }` 이다.
`axes`는 위 축 키의 배열로, 한 단계 안에서 4축이 골고루 담기도록 작성한다.

```js
scoringExamples: {
  high: [
    { utterance: '딱 3분이면 됩니다.', axes: ['timing', 'logic'], reason: '시간 구체화' },
    { utterance: '바쁘신 거 아는데요,', axes: ['emotion', 'trust'], reason: '상황 배려' },
  ],
  mid: [ /* ... */ ],
  low: [ /* ... */ ],
}
```

### 기능

- **로그인**: **아이디 + 비밀번호**를 `/api/admin-auth`로 검증 (정답 값은 서버 환경변수 `ADMIN_ID`·`ADMIN_PASSWORD`에만 존재하고, 없으면 `learn2`/`0067`로 폴백). 인증 상태는 sessionStorage에 임시 저장되어 탭을 닫으면 만료.
  관리자 전용 API가 다시 인증할 수 있도록 **입력한 아이디·비밀번호도 sessionStorage에 함께 보관**한다 (`src/admin/adminApi.js`).
  검증부는 `functions/_lib/adminAuth.js`의 `verifyAdminCredentials()` 하나뿐이다 — 관리자 API를 새로 만들면 반드시 이걸 쓸 것.
- **방 관리**: 새 방 만들기(4자리 랜덤 코드 자동 생성·중복 체크, 마스터 스테이지 5개 + settings 복사, status `open`), 방 목록(코드·이름·상태·참가자 수·생성일), 열기/닫기 토글, 입장 코드 크게 표시 + 복사 버튼.
- **방 삭제**: 방 목록의 **[🗑]** → "정말 삭제하시겠습니까? (되돌릴 수 없음)" 확인 →
  `POST /api/admin-delete-room`이 `rooms/{코드}`와 하위 컬렉션(`stages_*`, `players/*`,
  `players/*/stageResults_*`, 옛 구조의 `stages`·`stageResults`까지)을 재귀 삭제 → 목록 자동 갱신.
- **방 설정**: activeRounds(1~5) / stageTimeLimit(초, 분 환산 힌트) / maxMessagesPerStage. 저장 즉시 Firestore 반영 → 학습자 맵이 onSnapshot으로 실시간 갱신. 이미 진행 중인 스테이지는 방해하지 않고 다음 진입부터 적용.
- **참가자 모니터링**: players 컬렉션 onSnapshot 실시간 표시. 요약 카드(참가자 수·평균·최고·최저), 표(이름·소속·입장시간·상태·진행·총점), 행 클릭 시 스테이지별 점수 펼침.
- **CSV 내보내기**: 이름·소속·입장시간·스테이지별 점수·총점·상태. UTF-8 BOM 포함이라 엑셀에서 한글이 바로 열린다.

### 관리자 테스트 순서

1. `npm run seed:master` → Firebase 콘솔에서 **`templates/work/stages`와 `templates/life/stages`에 각각 5개 문서** 확인.
2. `npm run dev` → http://localhost:5173/admin 접속 (또는 입장 화면 **우측 상단 "⚙ 관리자"**) →
   아이디 `learn2` / 비밀번호 `0067`로 로그인. 둘 중 하나만 틀려도 같은 통합 오류 메시지가 떠야 한다.
3. 방 이름 입력 후 "새 방 만들기" (**트랙 드롭다운 없음** — 항상 두 트랙이 다 들어간다) → 4자리 코드 발급 확인.
   콘솔에서 `rooms/{코드}`에 `tracks: ['work','life']`, **`stages_work` 5개 + `stages_life` 5개**를 확인.
4. 다른 탭에서 http://localhost:5173 접속 → 발급된 코드로 입장 → **오프닝 컷신**(대사가 잘게 끊기지 않는지)
   → **트랙 선택 화면**에서 **일상 카드가 왼쪽**에 있는지 확인.
5. **일상** 선택 → 맵 상단 "일상 설득 트랙" 확인. **"🔄 트랙 바꾸기" 버튼이 없어야 한다**
   (다 풀기 전에는 트랙을 못 바꾼다) → 스테이지를 순서대로 플레이.
6. 마지막 스테이지를 마치면 결과 카드 버튼이 **"📊 설득 리포트 보기"** 로 바뀌고,
   맵을 거치지 않고 **그 트랙 리포트**로 넘어가는지 확인 → 하단 **[트랙 선택으로 돌아가기]**.
   허브에서 일상 카드에 **"완료됨"** + **[리포트 다시 보기]** 가 뜨는지, 눌러 저장된 리포트가 열리는지 확인.
   이 상태에서 **[게임 마치기]** 가 활성화되는지(한 트랙만 마쳐도) → 누르면 **아웃트로 컷신**(장면 전환·타이핑·건너뛰기)
   → **종료 화면** → [트랙 선택으로 돌아가기]로 남은 **업무** 트랙을 이어서 플레이할 수 있는지 확인.
   **일상에서 EP.02를 열었더라도 업무는 EP.01만 열려 있어야 한다** (트랙 독립).
   받침 있는 이름(예: 김민준)과 없는 이름(예: 이지수)으로 각각 입장해 오프닝·아웃트로 조사가 자연스러운지도 확인.
7. 플레이 중 채점이 4축 기준으로 도는지 확인 — 네트워크 탭에서 `/api/score` 요청에 `track`이 실리고,
   응답에 `axisScores: { emotion, logic, trust, timing }` 가 오는지 본다.
8. 나갔다가 같은 코드+이름+소속으로 재입장 → 트랙 선택 카드에 **두 트랙 진행상황이 모두** 표시되는지 확인.
9. 각 트랙에서 리포트 생성 → 리포트 상단 트랙명이 맞고 **그 트랙 스테이지만** 분석 대상인지,
   **"에토스/파토스" 같은 용어가 없는지** 확인.
10. 관리자 참가자 표: "진행" 칸에 `업무 n/5  일상 m/5`가 따로 뜨는지, 행을 펼치면
    **트랙별 점수·리포트가 각각** 나오는지 확인.
11. "CSV 다운로드" → 두 트랙 스테이지가 모두 컬럼으로 들어가고 `업무 합계`/`일상 합계`/`총점`이 맞는지 확인.
12. 관리자에서 activeRounds를 바꾸면 → 학습자 맵의 "준비 중" 범위가 실시간으로 바뀌는지 확인.
13. 방 "닫힘" 토글 → 학습자 입장 화면에서 해당 코드 입장이 거부되는지 확인.
14. 테스트용 방의 **[🗑]** → 확인 팝업 → 삭제 후 목록에서 사라지는지, Firebase 콘솔에서
    `rooms/{코드}` 아래에 **고아 문서(players·stages·stageResults)가 남지 않는지** 확인.

### ⚠️ 배포 전 점검 (보안 규칙 강화)

개발 단계라 Firestore 규칙이 열려 있어 클라이언트에서 방 생성/설정 변경이 가능하다. 배포 전 반드시:

- [ ] `templates/*`, `rooms/{code}` 쓰기와 `stages` 읽기(정답 필드 포함)를 제한하는 보안 규칙 적용
- [ ] 방 생성·설정 변경을 서버 함수(`/api/admin-*`) 경유로 이전 (admin-auth 세션 토큰 검증과 함께)
      — 방 **삭제**는 이미 `/api/admin-delete-room` 경유로 옮겨져 있다
- [ ] **`ADMIN_ID`·`ADMIN_PASSWORD`를 Cloudflare Secret으로 등록** — 배포 전 필수.
      **프로덕션에서는 두 값이 없으면 기본값(`learn2`/`0067`) 폴백이 차단되고 관리자 API가 500으로 막힌다**
      (`ENVIRONMENT`가 `development`가 아니면 프로덕션으로 간주). 저장소에 공개된 자격증명으로
      관리자 페이지가 열리는 일은 없지만, 등록하지 않으면 대시보드를 쓸 수 없다.
- [ ] 배포 환경의 `ENVIRONMENT`가 `production`인지 확인 (`wrangler.toml`의 `[env.production.vars]`
      또는 Cloudflare 대시보드). 값이 없어도 프로덕션으로 취급되므로 안전 쪽으로 기운다.
- [ ] 관리자 자격증명을 sessionStorage에 두는 대신 **단기 서명 토큰** 발급 방식으로 교체
      (`/api/admin-auth`가 토큰을 내려주고 `src/admin/adminApi.js`가 그 토큰만 보관하도록)
- [ ] 학습자용 스테이지 데이터는 공개 필드만 내려주는 `/api/stage` 엔드포인트로 이전

## Firebase 웹 앱 config 넣기

프론트엔드에서 Firestore의 스테이지 데이터를 직접 읽으려면 웹 앱 config가 필요하다.

1. [Firebase 콘솔](https://console.firebase.google.com/) → 프로젝트 선택
2. ⚙️ **프로젝트 설정** → **일반** 탭 → 아래 "내 앱" 섹션
3. 웹 앱이 없으면 **`</>`(웹)** 버튼으로 앱 추가 (호스팅 설정은 건너뛰어도 됨)
4. "SDK 설정 및 구성"에서 **구성(Config)** 선택 → `firebaseConfig` 객체 복사
5. `src/common/firebase.js`의 `firebaseConfig` 부분(★ 표시된 곳)에 붙여넣기

> 웹 config의 `apiKey`는 서버 비밀키가 아니라 공개 식별자라 프론트에 넣어도 된다. (Gemini 키·서비스 계정 키와는 다르다!)
> 클라이언트에서 Firestore를 읽으려면 보안 규칙이 `rooms` 컬렉션 읽기를 허용해야 한다. 또한 스테이지 문서에는 `hiddenNeed` 등 "정답" 필드가 있어 개발자 도구로 볼 수 있으므로, 프로토타입 이후에는 공개 필드만 내려주는 서버 엔드포인트로 옮기는 것을 권장.

## 게이지 공통 규칙

- 시작값 **50**, 범위 **0~100**, 발화당 변동 **-15 ~ +20**
- **85** = 설득 성공 기준선 (도달해도 자동 클리어 아님)
- 감정 임계값: `happy` (80 이상) / `normal` (50~79) / `worry` (30~49) / `angry` (30 미만)

## Firestore 데이터 구조

```
rooms/{roomCode}
  roomName, createdBy, createdAt, status
  settings: { activeRounds, stageTimeLimit, maxMessagesPerStage, evalModel, reportModel }
  stages/{stageId}:
    order, title, characterName, characterType,
    situation, introDialogue,
    surfaceNeed, hiddenNeed, initialStance, persuasionGoal,
    resistancePoints[], scoringExamples{high, mid, low},
    assetMap{happy, normal, worry, angry}
```

## 시드 스크립트 실행 방법

테스트용 샘플 룸 `DEMO01`과 5개 스테이지 데이터를 Firestore에 넣는다.

### 1. serviceAccountKey.json 발급

1. [Firebase 콘솔](https://console.firebase.google.com/) 접속 → 해당 프로젝트 선택
2. 좌측 상단 톱니바퀴 ⚙️ → **프로젝트 설정** → **서비스 계정** 탭
3. **새 비공개 키 생성** 버튼 클릭 → JSON 파일 다운로드
4. 다운로드한 파일 이름을 `serviceAccountKey.json`으로 바꿔 **프로젝트 루트**에 저장

> ⚠️ 이 파일은 관리자 권한 키이므로 절대 커밋하거나 공유하면 안 된다. (`.gitignore`에 이미 등록됨)

### 2. 의존성 설치 및 실행

```bash
npm install
node scripts/seed.js
```

- 이미 `rooms/DEMO01` 데이터가 있으면 덮어쓸지 물어본다 (y/N).
- 확인 없이 강제로 덮어쓰려면: `node scripts/seed.js --force`

### 3. 시드 데이터 내용

| Stage | 제목 | 캐릭터 | 타입 |
|-------|------|--------|------|
| 1 | 바쁜 선배에게 5분 얻어내기 | 한 과장 | internal |
| 2 | 화난 고객의 진짜 마음 읽기 | 박 고객 | external |
| 3 | 실패를 기억하는 상사 설득하기 | 정 부장 | internal |
| 4 | 예산을 미루는 거래처와 접점 찾기 | 윤 대표 | external |
| 5 | 떠나려는 핵심 팀원 붙잡기 | 이 책임 | internal |

> `assetMap`의 이미지 경로(`/assets/{characterName}/happy.png` 등)는 아직 실제 파일이 없는 placeholder다.

## API (Cloudflare Pages Functions)

`functions/` 폴더가 Cloudflare Pages Functions로 배포된다.

| 엔드포인트 | 메서드 | 역할 |
|-----------|--------|------|
| `/api/score` | POST | 학습자 발화를 Gemini로 채점하고 캐릭터 응답 반환 |
| `/api/report` | POST | 전체 대화 로그를 분석해 최종 설득 리포트 생성 |
| `/api/admin-auth` | POST | 관리자 아이디·비밀번호 검증 |
| `/api/admin-delete-room` | POST | 방 + 하위 데이터 재귀 삭제 (관리자 인증 필요) |

공통 로직(Firestore REST 인증·조회, Gemini 호출)은 `functions/_lib/gcp.js`에 있다 (언더스코어 폴더는 라우팅되지 않음).

### 필요한 환경변수

| 변수 | 설명 |
|------|------|
| `GEMINI_API_KEY` | Gemini API 키. **절대 프론트엔드에 노출 금지** — 서버 함수에서만 읽는다 |
| `FIREBASE_PROJECT_ID` | `serviceAccountKey.json`의 `project_id` |
| `FIREBASE_CLIENT_EMAIL` | `serviceAccountKey.json`의 `client_email` |
| `FIREBASE_PRIVATE_KEY` | `serviceAccountKey.json`의 `private_key` (줄바꿈이 `\n`으로 된 한 줄 전체) |
| `ADMIN_ID` | 관리자 페이지 아이디 (개발 환경에 한해 없으면 `learn2`) |
| `ADMIN_PASSWORD` | 관리자 페이지 비밀번호 (개발 환경에 한해 없으면 `0067`) |
| `ENVIRONMENT` | `development`일 때만 위 기본값 폴백 허용. 그 외·미설정이면 프로덕션으로 보고 500 |

- **배포 환경**: Cloudflare 대시보드 → 해당 Pages 프로젝트 → *Settings → Environment variables*에 등록 (Secret 타입 권장).
- **로컬 개발**: 프로젝트 루트의 `.dev.vars` 파일에서 자동으로 읽는다 (`.gitignore` 등록됨).

> Cloudflare Workers 런타임에서는 `firebase-admin`이 동작하지 않으므로, `score.js`는 서비스 계정으로 JWT를 서명해 OAuth 토큰을 받고 **Firestore REST API**로 스테이지 데이터를 읽는다. `hiddenNeed`, `scoringExamples` 같은 "정답" 데이터는 서버에서만 다루고 프론트에 내려보내지 않는다.

### 로컬 테스트 방법

```bash
# 1. .dev.vars 생성 (serviceAccountKey.json에서 Firebase 값 자동 추출)
node scripts/make-dev-vars.js
#    → 생성된 .dev.vars 를 열어 GEMINI_API_KEY 와 ADMIN_ID / ADMIN_PASSWORD 를 실제 값으로 수정
#    (serviceAccountKey.json 이 없다면 위 "필요한 환경변수" 표를 보고 .dev.vars 를 직접 만들어도 된다.
#     로컬에서는 ENVIRONMENT=development 도 함께 넣어야 관리자 기본값 폴백이 동작한다)

# 2. 로컬 서버 실행
npm run dev        # web(Vite, :5173) + api(wrangler, :8788) 동시 실행
npm run dev:api    # API만 단독으로 띄우고 싶을 때 (http://127.0.0.1:8788)
```

### 샘플 요청/응답

**채점** — `POST /api/score`

```bash
curl -X POST http://127.0.0.1:8788/api/score \
  -H "Content-Type: application/json" \
  -d '{
    "roomCode": "DEMO01",
    "stageId": "stage1",
    "currentGauge": 50,
    "conversationHistory": [
      { "role": "character", "text": "아, 지금 좀 정신이 없어서… 급한 거 아니면 이따 얘기하면 안 될까요?" }
    ],
    "userMessage": "바쁘신 거 아는데, 딱 3분이면 됩니다. 문서 위치만 알려주시면 돼요."
  }'
```

응답 (200):

```json
{
  "scoreDelta": 15,
  "newGauge": 65,
  "newEmotion": "normal",
  "actionTags": ["상황존중", "숨은니즈파악"],
  "characterReply": "3분이요? 음… 그 정도면 괜찮아요. 어떤 문서 찾으시는데요?",
  "feedback": "소요 시간과 요청 내용을 구체적으로 제시해 상대의 부담을 줄인 좋은 접근이에요."
}
```

- `newGauge`/`newEmotion`은 모델 출력이 아니라 **서버에서 `scoreDelta`를 clamp해 재계산**한 값이라 항상 규칙과 일치한다.
- Gemini 응답 파싱에 실패하면 게임이 멈추지 않도록 `scoreDelta: 0` 안전 기본값에 `"degraded": true` 필드를 붙여 반환한다.
- 에러: 잘못된 요청 400, 룸/스테이지 없음 404, Firestore 장애 502, 환경변수 누락 500 — 모두 `{ "error": "..." }` 형태.

**관리자 인증** — `POST /api/admin-auth`

```bash
curl -X POST http://127.0.0.1:8788/api/admin-auth \
  -H "Content-Type: application/json" \
  -d '{ "id": "learn2", "password": "0067" }'
```

응답: 성공 시 200 `{ "success": true }`.
아이디·비밀번호 중 하나라도 틀리면 401 `{ "success": false, "error": "아이디 또는 비밀번호가 올바르지 않습니다." }`
(무엇이 틀렸는지는 구분해 주지 않는다). 둘 중 하나가 비어 있으면 400.
서버에 `ADMIN_ID`/`ADMIN_PASSWORD`가 설정되지 않은 프로덕션이면 500
`{ "success": false, "error": "관리자 자격증명이 서버에 설정되지 않았습니다." }`.

**방 삭제** — `POST /api/admin-delete-room` (⚠️ 되돌릴 수 없다)

```bash
curl -X POST http://127.0.0.1:8788/api/admin-delete-room \
  -H "Content-Type: application/json" \
  -d '{ "id": "learn2", "password": "0067", "roomCode": "3YBV" }'
```

응답: 성공 시 200 `{ "success": true, "deleted": { "players": 2, "results": 6, "stages": 10 } }`.
비밀번호 오류 401 · 코드 형식 오류 400 · 없는 방 404 · 삭제 중 오류 500.
방 코드는 문서 경로에 그대로 들어가므로 **영숫자 2~16자만** 허용한다(경로 조작 차단).
