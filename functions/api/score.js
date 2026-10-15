/**
 * POST /api/score — 설득 게임 채점 함수 (Cloudflare Pages Function)
 *
 * 학습자의 발화를 받아:
 *   1. Firestore에서 스테이지 데이터를 읽고 (REST API + 서비스 계정 JWT)
 *   2. Gemini API로 채점을 요청한 뒤
 *   3. { scoreDelta, newGauge, newEmotion, actionTags, characterReply, feedback } JSON을 반환한다.
 *
 * 필요한 환경변수 (Cloudflare 대시보드 또는 로컬 .dev.vars):
 *   GEMINI_API_KEY        - Gemini API 키 (절대 프론트엔드에 노출 금지)
 *   FIREBASE_PROJECT_ID   - Firebase 프로젝트 ID (serviceAccountKey.json의 project_id)
 *   FIREBASE_CLIENT_EMAIL - 서비스 계정 이메일 (client_email)
 *   FIREBASE_PRIVATE_KEY  - 서비스 계정 비공개 키 (private_key, \n 포함 한 줄로)
 */

import {
  clamp,
  jsonResponse,
  errorResponse,
  getAccessToken,
  getDocument,
  callGemini,
  parseGeminiJson,
} from '../_lib/gcp.js';

const DEFAULT_EVAL_MODEL = 'gemini-3-flash-preview';
// 한 방(rooms/{code})에 두 트랙이 모두 들어 있고, 스테이지는 트랙별 서브컬렉션에 나뉘어 있다.
// (src/common/tracks.js와 이름 규칙을 맞춘다)
const TRACK_KEYS = ['work', 'life'];
const stagesCollection = (track) => `stages_${track}`;
const GAUGE_MIN = 0;
const GAUGE_MAX = 100;
const HISTORY_LIMIT = 30; // 프롬프트에 포함할 최근 대화 수

// ── 난이도 ───────────────────────────────────────────────────
// 값의 원본은 scripts/stageData.js의 DIFFICULTY_CURVE이고, 스테이지 문서에 함께 저장된다.
// 여기서는 문서에서 읽고, 빠진 항목만 옛 동작과 같은 값으로 메운다.
// (src/common/difficulty.js의 readDifficulty와 같은 규칙 — 한쪽을 고치면 다른 쪽도 고칠 것)
const LEGACY_DIFFICULTY = {
  level: 3,
  startGauge: 50,
  successLine: 85,
  resistance: 3,
  targetTurns: 10,
  maxDelta: 20,
  minDelta: -15,
  floorBonus: 2,
};

function readDifficulty(stage) {
  const d = stage?.difficulty || {};
  const int = (v, fb) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : fb);
  return {
    level: int(d.level, LEGACY_DIFFICULTY.level),
    startGauge: int(d.startGauge, LEGACY_DIFFICULTY.startGauge),
    successLine: int(d.successLine, LEGACY_DIFFICULTY.successLine),
    resistance: clamp(int(d.resistance, LEGACY_DIFFICULTY.resistance), 1, 5),
    targetTurns: Math.max(1, int(d.targetTurns, LEGACY_DIFFICULTY.targetTurns)),
    maxDelta: int(d.maxDelta, LEGACY_DIFFICULTY.maxDelta),
    minDelta: int(d.minDelta, LEGACY_DIFFICULTY.minDelta),
    floorBonus: int(d.floorBonus, LEGACY_DIFFICULTY.floorBonus),
  };
}

/**
 * ── 숨은 의도 단계 공개 ──────────────────────────────────────
 *
 * 숨은 니즈를 처음부터 통째로 알려주면 추리할 거리가 없고,
 * 끝까지 숨기면 학습자는 뭘 맞혀야 하는지도 모른 채 헤맨다.
 * 그래서 게이지 진행도에 따라 **한 겹씩** 드러낸다.
 *
 *   0단계 (진행 0%~)    겉으로 하는 말만. 속내는 전혀 안 비친다.
 *   1단계 (진행 33%~)   말끝이나 표정으로 어렴풋이 흘린다.
 *   2단계 (진행 66%~)   구체적인 사정을 꺼낸다.
 *   3단계 (진행 90%~)   진짜 속내를 직접 말한다.
 *
 * 임계값을 비율로 잡은 이유: 스테이지마다 시작값·성공선이 다르므로
 * 절대 게이지로 적으면 난이도를 바꿀 때마다 전부 다시 맞춰야 한다.
 */
const LAYER_THRESHOLDS = [0, 0.33, 0.66, 0.9];

/**
 * 한 턴에 여러 단계를 건너뛰지 않도록 조인다.
 * 큰 점수가 한 번에 오르면 단계가 1→3으로 점프해 "2단계 단서"가 통째로 사라진다.
 * 직전 단계 + 1 까지만 인정해, 벗겨지는 과정을 학습자가 모두 보게 한다.
 */
function nextLayer(diff, prevGauge, newGauge) {
  return Math.min(revealedLayerFor(diff, newGauge), revealedLayerFor(diff, prevGauge) + 1);
}

/** 현재 게이지가 몇 단계까지 열렸는지 (0~3) */
function revealedLayerFor(diff, gauge) {
  const span = diff.successLine - diff.startGauge;
  const progress = span > 0 ? (gauge - diff.startGauge) / span : 0;
  let layer = 0;
  for (let i = 0; i < LAYER_THRESHOLDS.length; i += 1) {
    if (progress >= LAYER_THRESHOLDS[i]) layer = i;
  }
  return layer;
}

/** 단계 공개 지시문 — hiddenNeedLayers가 있는 시나리오에서만 붙는다 */
function layerInstruction(stage, layer) {
  const layers = stage.hiddenNeedLayers;
  if (!Array.isArray(layers) || layers.length === 0) return '';

  const idx = Math.min(layer, layers.length - 1);
  const openable = layers.slice(0, idx + 1).map((t, i) => `  ${i}단계: ${t}`).join('\n');
  const next = layers[idx + 1];

  return `

## 속내를 어디까지 드러낼지 (지금은 ${idx}단계)
상대는 처음부터 속을 다 보이지 않는다. 마음이 열린 만큼만 드러낸다.
지금까지 꺼내도 되는 것:
${openable}

- **${idx}단계를 넘어서는 내용은 아직 말하지 마라.** ${
    next ? `특히 다음 단계("${next}")는 지금 꺼내면 안 된다.` : '이미 마지막 단계다 — 속내를 솔직하게 말해도 된다.'
  }
- ${idx}단계의 내용은 **이번 대사에 자연스럽게 녹여라.** 설명조로 늘어놓지 말고,
  말끝을 흐리거나 혼잣말처럼 흘리거나 되물으면서 비치는 식으로.
- 학습자가 이미 짚어낸 단계는 다시 감추지 말고 인정해라. 한 번 열린 문은 닫히지 않는다.`;
}

/** 저항 단계별 연기 지침 — 캐릭터가 "얼마나 쉽게 열리는가"를 결정한다 */
const RESISTANCE_GUIDE = {
  1: '상대는 이미 대화할 마음이 있다. 결이 맞는 말 한마디에도 눈에 띄게 누그러진다. 한두 번만 제대로 짚어도 마음을 연다.',
  2: '상대는 조심스럽지만 적대적이지는 않다. 두세 번 결이 맞으면 경계를 푼다.',
  3: '상대는 분명한 걱정을 안고 있다. 그 걱정이 실제로 해소되어야 한 겹씩 열린다. 좋은 말만으로는 부족하다.',
  4: '상대는 과거 경험이나 이해관계 때문에 쉽게 믿지 않는다. 구체적인 근거와 책임이 따라야 조금씩 움직인다.',
  5: '상대는 거의 닫혀 있다. 여러 번에 걸쳐 일관되게 신뢰를 쌓아야만 겨우 문이 열린다. 한 번의 좋은 말로는 거의 변하지 않는다.',
};

// ── 음성(어조) 평가 ──────────────────────────────────────────
// 학습자가 마이크로 말한 경우에만 오디오가 함께 온다.
// [원칙] 어조는 점수에 반영하지 않는다. 4축·scoreDelta·게이지는 지금까지처럼 텍스트만 보고 매기고,
//        어조는 최종 리포트의 "전달력" 코칭 재료로만 따로 모은다.
//        (오디오 기반 판단은 텍스트 채점만큼 일관되지 않아, 점수에 섞으면 4축 밸런스가 흔들린다)
const ALLOWED_AUDIO_MIME = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/aac', 'audio/flac'];
const MAX_AUDIO_BASE64 = 4_000_000; // base64 문자 수 상한 (원본 약 3MB)

const TONE_DIMENSIONS = {
  pace: ['fast', 'natural', 'slow'],
  warmth: ['warm', 'neutral', 'cold'],
  confidence: ['confident', 'neutral', 'hesitant'],
};

/**
 * 요청으로 들어온 오디오를 검증한다.
 * @returns {{mimeType: string, data: string} | null} 형식이 어긋나면 null (어조 평가만 조용히 건너뛴다)
 */
function validateAudio(audio) {
  if (!audio || typeof audio !== 'object') return null;
  const { mimeType, data } = audio;
  if (typeof mimeType !== 'string' || !ALLOWED_AUDIO_MIME.includes(mimeType)) {
    if (mimeType) console.warn(`[score] 지원하지 않는 오디오 형식: ${mimeType} — 어조 평가를 건너뜁니다.`);
    return null;
  }
  if (typeof data !== 'string' || data.length === 0) return null;
  if (data.length > MAX_AUDIO_BASE64) {
    console.warn(`[score] 오디오가 너무 큽니다(${data.length}자) — 어조 평가를 건너뜁니다.`);
    return null;
  }
  return { mimeType, data };
}

/** 모델이 돌려준 어조 값을 정규화 — 이상한 값이면 중립으로 떨어뜨린다 */
function normalizeTone(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (key) => {
    const allowed = TONE_DIMENSIONS[key];
    const v = typeof raw[key] === 'string' ? raw[key].trim() : '';
    return allowed.includes(v) ? v : allowed[1]; // 가운데 값 = 중립
  };
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : '';
  return { pace: pick('pace'), warmth: pick('warmth'), confidence: pick('confidence'), note };
}

/**
 * 게이지 값 → 감정 상태 (5단계).
 * 경계는 그 스테이지의 성공선을 기준으로 상대적으로 잡는다.
 * (예전에는 85 고정이라, 성공선이 75인 입문 스테이지에서는 설득에 성공해도
 *  가장 밝은 표정이 끝내 안 나왔다)
 * src/common/difficulty.js의 emotionFor와 같은 규칙이다.
 */
function emotionFor(gauge, successLine = 85) {
  if (gauge >= successLine) return 'very_happy';
  if (gauge >= successLine - 15) return 'happy';
  if (gauge >= successLine - 35) return 'normal';
  if (gauge >= successLine - 55) return 'worry';
  return 'angry';
}

// ─────────────────────────────────────────────────────────────
// 채점 프롬프트
// ─────────────────────────────────────────────────────────────

/**
 * 채점 4축 — 업무/일상 두 트랙 공통, 각 25% 균등 비중.
 * 축 키는 scripts/stageData.js의 SCORING_AXES와 맞춘다.
 */
const SCORING_AXES = [
  {
    key: 'emotion',
    label: '감정 읽기',
    guide: '상대의 감정·상태를 알아차리고 말로 인정해 주었는가. 넘겨짚지 않고 물어봤는가.',
  },
  {
    key: 'logic',
    label: '논리·근거',
    guide: '주장에 구체적 근거·수치·대안이 붙었는가. 상대가 걱정하는 리스크에 통제안을 제시했는가.',
  },
  {
    key: 'trust',
    label: '신뢰 형성',
    guide: '상대의 입장·기여·제약을 존중했는가. 과장·압박 없이 지킬 수 있는 말을 했는가.',
  },
  {
    key: 'timing',
    label: '타이밍',
    guide: '지금 이 대화 흐름에 맞는 말이었는가. 너무 이르게 밀어붙이거나 기회를 놓치지 않았는가.',
  },
];

/**
 * 캐릭터 관계 설명.
 * 현재 시나리오는 '후배', '상사', '고객'처럼 한국어 라벨을 그대로 쓴다.
 * 트랙 도입 전 데이터의 'internal'/'external'만 사람이 읽는 말로 옮긴다.
 */
function describeCharacterType(type) {
  if (type === 'internal') return '사내 인물';
  if (type === 'external') return '외부 인물';
  return type || '관계 정보 없음';
}

/** 스테이지별 참고 예시 렌더링 — 항목은 { utterance, axes, reason } */
function formatScoringExamples(scoringExamples) {
  const LEVELS = [
    ['high', '높은 점수 (+12~+20)'],
    ['mid', '중간 점수 (+3~+8)'],
    ['low', '낮은 점수 (-5~-15)'],
  ];
  const axisLabel = (key) => SCORING_AXES.find((a) => a.key === key)?.label || key;

  const lines = [];
  for (const [level, label] of LEVELS) {
    const items = scoringExamples?.[level];
    if (!Array.isArray(items) || !items.length) continue;
    lines.push(`- ${label}`);
    for (const it of items) {
      const axes = Array.isArray(it.axes) ? it.axes.map(axisLabel).join('·') : '';
      lines.push(`  · "${it.utterance}"${axes ? ` [${axes}]` : ''} → ${it.reason}`);
    }
  }
  return lines.join('\n');
}

/**
 * 오디오가 함께 왔을 때만 붙는 어조 평가 지시문.
 * "점수에 반영하지 말 것"을 명시해 4축 채점이 음성 때문에 흔들리지 않게 한다.
 */
function toneInstruction(characterName) {
  return `
## 첨부된 음성 (어조 평가 전용)
이 요청에는 학습자가 실제로 말한 음성이 함께 들어 있습니다. 위 "학습자의 이번 발화" 텍스트는 그 음성을
받아쓴 것입니다(받아쓰기 오류가 있을 수 있으니, 내용 판단은 텍스트를 기준으로 하십시오).

음성을 듣고 **말투와 전달 방식**만 별도로 평가해 tone 필드에 담으십시오.
- pace: 말의 속도 — "fast"(급하게 몰아침) / "natural"(편안함) / "slow"(지나치게 느리거나 뜸들임)
- warmth: 목소리의 온도 — "warm"(따뜻하고 배려가 느껴짐) / "neutral"(무난함) / "cold"(사무적·딱딱함)
- confidence: 전달의 확신 — "confident"(안정적이고 분명함) / "neutral"(보통) / "hesitant"(머뭇거리거나 말끝이 흐려짐)
- note: 전달 방식에 대한 짧은 코칭 한 줄(존댓말, 1문장). 말의 "내용"이 아니라 "전달"에 대해서만 쓸 것.
  예) "말끝이 흐려져서 확신이 덜 전해졌어요.", "속도가 편안해서 ${characterName}이(가) 듣기 좋았겠어요."

⚠ 매우 중요: **어조는 scoreDelta와 axisScores에 절대 반영하지 마십시오.**
점수는 지금까지와 동일하게 발화 "내용"만 보고 매깁니다. 음성이 아무리 좋거나 나빠도 점수는 달라지지 않습니다.
characterReply에도 목소리·말투를 지적하는 말을 넣지 마십시오.`;
}

/**
 * 지금 몇 번째 턴인지와 난이도로 "이 시점의 기대 게이지"를 구한다.
 * 채점이 이 궤도를 기준으로 후하거나 엄해진다 — 예전처럼 매 턴을 독립적으로 보면
 * 좋은 말 3번에 성공선을 넘고 남은 턴이 무의미해진다.
 */
function paceGuidance(diff, currentGauge, turnIndex) {
  const span = diff.successLine - diff.startGauge;
  const progress = Math.min(1, turnIndex / diff.targetTurns);
  const expected = Math.round(diff.startGauge + span * progress);
  const ahead = currentGauge - expected;

  if (ahead >= 8) {
    return {
      expected,
      note:
        `지금은 ${turnIndex}번째 발화이고, 설계된 궤도상 이 시점의 기대 게이지는 ${expected} 정도인데 ` +
        `실제로는 ${currentGauge}로 **한참 앞서 있다**. 상대가 너무 쉽게 넘어가고 있다는 뜻이다.\n` +
        `  → 이번 턴은 **평소보다 엄격하게** 매겨라. 비슷한 말을 반복하거나 이미 인정받은 내용을 다시 꺼내면 ` +
        `가점을 거의 주지 말 것(0~+2). 새로운 것을 짚었을 때만 의미 있게 올려라.`,
    };
  }
  if (ahead <= -12) {
    return {
      expected,
      note:
        `지금은 ${turnIndex}번째 발화이고, 기대 게이지 ${expected}보다 실제가 ${currentGauge}로 **뒤처져 있다**.\n` +
        `  → 점수를 억지로 올려주지는 말되, 방향이 맞는 시도에는 확실히 가점해 학습자가 회복할 길을 열어 둬라.`,
    };
  }
  return {
    expected,
    note: `지금은 ${turnIndex}번째 발화이고, 기대 게이지(${expected})와 실제(${currentGauge})가 비슷한 정상 궤도다. 기준대로 매겨라.`,
  };
}

function buildPrompt(stage, conversationHistory, userMessage, currentGauge, hasAudio, diff, turnIndex, stallTurns) {
  const history = (conversationHistory || [])
    .slice(-HISTORY_LIMIT)
    .map((m) => `${m.role === 'user' ? '학습자' : stage.characterName}: ${m.text}`)
    .join('\n');

  const examples = formatScoringExamples(stage.scoringExamples);
  const axisGuide = SCORING_AXES.map((a, i) => `${i + 1}. ${a.label} (25%) — ${a.guide}`).join('\n');
  // hiddenNeedLayers(단계 공개)가 있으면 그쪽을 쓰고, 없으면 옛 단서 한 줄을 쓴다
  const clue =
    !Array.isArray(stage.hiddenNeedLayers) && stage.hiddenNeedClue
      ? `\n- 숨은 니즈 단서 대사 (대화 중 자연스럽게 흘릴 것): "${stage.hiddenNeedClue}"`
      : '';
  // 초기 태도·설득 목표는 선택 필드다 — 없으면 줄 자체를 빼서 "undefined"가 새지 않게 한다
  const stance = stage.initialStance ? `\n- 캐릭터의 초기 태도: ${stage.initialStance}` : '';
  const goal =
    stage.persuasionGoal ||
    `게이지 ${diff.successLine} 도달 — ${stage.characterName}이(가) 경계를 풀고 학습자의 말을 받아들이는 반응을 보이게 하기`;

  const pace = paceGuidance(diff, currentGauge, turnIndex);
  // 정체 구간 — 결렬도 성공도 아닌 채 같은 자리를 맴도는 상태.
  // 시뮬레이션에서 18턴을 쓰고도 게이지가 45~67에서만 오르내린 경우가 나왔다.
  // 실제 사람이라면 "그게 아니라…" 하고 더 분명한 신호를 준다 — 그걸 규칙으로 만든다.
  const stallRule =
    stallTurns >= 4
      ? `

## ⚠ 지금 대화가 제자리걸음이다 (${stallTurns}턴째 진전 없음)
학습자가 같은 방식만 반복하고 있고 상대의 마음은 움직이지 않았다.
이대로 두면 남은 시간이 통째로 낭비된다. 이번 대사에서 **${stage.characterName}이(가) 직접 길을 비춰라.**
- 무엇이 부족한지를 **상대의 입장에서** 말하라. 정답을 알려주는 게 아니라, 원하는 것을 드러내는 방식으로.
  예) "자꾸 약속하라고만 하지 말고… 나는 당신이 내 사정을 한 번이라도 물어봐 주길 바랐어요."
      "그 얘기 말고… 내가 왜 이러는지는 안 궁금해요?"
- 채점·점수·게임 용어는 절대 쓰지 말 것. 어디까지나 캐릭터가 답답해서 꺼내는 말이어야 한다.
- 그래도 학습자가 못 알아들으면, 다음 턴에는 대화를 정리하려는 기색을 보여도 된다.`
      : '';
  // 상대를 여는 열쇠 — 시나리오에 openingKeys가 있으면 쓴다 (없으면 저항 멘트만으로 연기)
  const keys = Array.isArray(stage.openingKeys) && stage.openingKeys.length
    ? `\n- 상대가 열리는 조건 (이런 말이 나오면 실제로 한 겹 열린다): ${stage.openingKeys.map((k) => `"${k}"`).join(', ')}`
    : '';
  // 초반 스테이지에서만 "성의 있으면 최소 이만큼"을 보장한다. 0이면 진짜 실패가 가능하다.
  const floorRule =
    diff.floorBonus > 0
      ? `- 방향이 맞고 성의 있는 시도라면 최소 +${diff.floorBonus}는 주어 학습자가 전진하는 체감을 갖게 한다.`
      : `- **성의만으로는 점수를 주지 않는다.** 방향이 맞아도 상대의 걱정을 실제로 건드리지 못했다면 0이다.\n` +
        `  이 스테이지는 설득에 실패할 수 있도록 설계되어 있다. 억지로 올려주지 말 것.`;

  return `당신은 설득 훈련 게임의 채점자이자, 게임 속 캐릭터 "${stage.characterName}"의 역할 연기자입니다.
학습자의 이번 발화를 채점하고, 캐릭터로서 다음 대사를 만들어야 합니다.

## 시나리오
- 상황: ${stage.situation}
- 캐릭터: ${stage.characterName} (${describeCharacterType(stage.characterType)})${stance}
- 표면 니즈 (캐릭터가 겉으로 말하는 것): ${stage.surfaceNeed}
- 숨은 니즈 (캐릭터가 진짜 원하는 것, 학습자가 파악해야 함): ${stage.hiddenNeed}${clue}
- 설득 목표: ${goal}
- 캐릭터가 자주 쓰는 저항 멘트: ${(stage.resistancePoints || []).map((r) => `"${r}"`).join(', ')}${keys}

## 이 스테이지의 난이도 (${diff.level}단계 / 5단계 중)
- 상대의 완고함: ${diff.resistance}단계 — ${RESISTANCE_GUIDE[diff.resistance]}
- 설득 성공선: 게이지 ${diff.successLine} (시작값은 ${diff.startGauge}였다)
- 설계 기준 턴 수: 약 ${diff.targetTurns}턴에 성공선에 닿도록 맞춰져 있다
- 이번 턴 점수 범위: ${diff.minDelta} ~ +${diff.maxDelta} (난이도가 높을수록 한 방에 뒤집을 수 없다)

${layerInstruction(stage, revealedLayerFor(diff, currentGauge))}

## 지금까지의 대화
${history || '(첫 발화입니다)'}

## 학습자의 이번 발화
"${userMessage}"

## 현재 설득 게이지와 진행 속도
${currentGauge} / 100 (${diff.successLine} 이상이면 설득 성공)
${pace.note}${stallRule}

## 채점 기준 — 4축 균등 (각 25%)
학습자의 이번 발화가 아래 네 축 각각에 어떻게 기여했는지 먼저 축별로 판단한 뒤,
네 축을 **동일한 비중으로 합산**해 최종 scoreDelta를 산출하십시오.

${axisGuide}

축별 판단 방법:
- 각 축을 -5 ~ +5 로 평가한다.
  · 그 축을 제대로 살렸으면 +4 ~ +5
  · 방향은 맞지만 다소 약하거나 구체성이 부족하면 +2 ~ +3
  · 이번 발화와 무관한 축은 0
  · 그 축을 해치는 발화(감정 무시·압박·비난·과장·존중 결여)는 -2 ~ -5
- 4축이 모두 고르게 높을 필요는 없다. 다만 여러 축을 동시에 살린 발화,
  특히 **숨은 니즈를 짚은 발화**는 확실히 더 높게 평가한다.
${floorRule}
- **같은 말의 반복에는 점수를 주지 않는다.** 이미 인정받은 내용을 다시 꺼내거나,
  표현만 바꾼 같은 취지의 말은 처음만큼 효과가 없다 (0 ~ +2).
  설득은 쌓아 올리는 것이지 같은 자리를 맴도는 게 아니다.
- 무성의한 한두 마디, 대화와 무관한 발화, 방향이 틀린 발화(상대 무시·압박·비난·과장·회피)는
  부분 점수 없이 0 또는 감점.
- 최종 scoreDelta는 정수, **${diff.minDelta} ~ +${diff.maxDelta}** 범위로 맞춘다.
  (이 상한은 난이도에서 온 값이다. 아무리 훌륭한 발화여도 이 범위를 넘지 않는다)

## 이 스테이지의 채점 참고 예시
각 예시 뒤 대괄호는 그 발화가 주로 살린 축이다.
${examples || '(예시 없음 — 위 4축 기준으로만 판단하십시오)'}

## characterReply 작성 규칙 (페르소나 저항 곡선)
- ${stage.characterName}은(는) 초반엔 방어적이고 신중하다. 위 "저항 멘트"와 인물의 걱정(상황·성격에서
  비롯된)에 충실하게 경계한다. 완고함의 정도는 위 난이도의 ${diff.resistance}단계를 따른다.
- 학습자가 결이 맞는 시도를 이어가면 게이지가 오를수록 경계를 조금씩 푼다.
  태도가 한 번에 급변하지 말고 서서히 열리게 할 것.
- 게이지 구간별 톤: 낮으면(저항 멘트처럼) 방어적, 중간이면 반신반의,
  ${diff.successLine} 이상이면 설득 목표에 명시된 반응에 가깝게.
- 한국어 구어체 1~3문장. 캐릭터를 벗어난 설명이나 채점·점수 언급은 절대 하지 말 것.

### ⚠ 대화를 끊지 말 것 (가장 중요한 규칙)
방어적인 것과 대화를 닫아버리는 것은 다르다. **매 대사에는 학습자가 이어받을 실마리를 반드시 하나 남긴다.**
다음 중 최소 하나를 넣어라:
  · 되묻기 — "그래서 구체적으로 어떻게 하자는 건데?"
  · 자기 걱정 드러내기 — "나는 그게 또 흐지부지될까 봐 걱정이야."
  · 조건 달기 — "그게 확실하면 생각은 해볼게."
  · 감정 토로 — "솔직히 좀 지쳤어."
금지: "됐어요.", "할 말 없습니다.", "그만하죠." 처럼 **학습자가 받아칠 거리가 없는 단절형 대사.**
설득에 실패하고 있더라도 상대는 계속 말을 섞는다 — 학습자가 할 말을 잃게 만들면 그 스테이지는 고장 난 것이다.
거절하더라도 왜 거절하는지, 무엇이 있어야 마음이 움직일지를 상대의 말로 드러내라.

### ⚠ 같은 말을 반복하지 말 것
위 "지금까지의 대화"에서 당신(${stage.characterName})이 이미 한 말을 다시 꺼내지 마라.
학습자가 제자리걸음이어도 **상대까지 같은 대사를 돌리면 대화가 죽는다.**
- 직전 두 대사와 같은 취지라면 **다른 각도**로 말하라.
  예) 계속 거절만 하지 말고 → 조건을 걸어보거나, 화를 내거나, 한 발 물러서거나,
      다른 걱정을 꺼내거나, 지쳐서 말수가 줄거나, 자리를 정리하려 하거나.
- 학습자가 같은 요구만 반복하면, 상대의 **감정이 변해야 한다** (답답함 → 서운함 → 체념 → 분노처럼).
  내용이 아니라 온도가 달라지는 것으로 진전을 만들어라.

### 대사 형식
- **대사만 쓴다.** "(한숨을 쉬며)", "(안내문을 밀어 넣으며)" 같은 괄호 지문·행동 묘사를 넣지 마라.
  표정과 동작은 화면의 캐릭터 이미지가 보여주므로, 글로 적으면 중복되고 어색하다.
- 이름표("엄마:")나 따옴표로 감싸지 말고, 할 말만 그대로 쓴다.

## 은근한 방향 힌트 (크게 틀렸을 때만 — 남발 금지)
- 이번 발화가 크게 잘못된 방향일 때만(대략 scoreDelta -6 이하, 즉 상대를 무시·압박·비난·과장·회피한 경우)
  캐릭터의 대사에 자연스러운 방향 힌트를 녹인다.
  예) 몰아붙이면 → "그렇게 다그치면 나는 더 마음이 닫히는데…"
      감정을 건너뛰고 해결책부터 던지면 → "해결책보다… 그냥 내 얘길 좀 들어줬으면 했어요."
- 어디까지나 ${stage.characterName}이(가) 자기 감정·입장을 말하는 형태로 "그 방향은 아니다"를 은근히 신호하는 정도.
  무엇을 말해야 하는지 정답을 직접 알려주지 말 것.
- 응답이 괜찮거나(가점) 보통일 때(scoreDelta가 0 근처)는 힌트를 넣지 말 것.
${hasAudio ? toneInstruction(stage.characterName) : ''}

## actionTags 규칙
학습자의 이번 발화에 해당하는 행동 태그를 0~3개 고를 것.
예시: "공감", "숨은니즈파악", "근거제시", "해결책제안", "질문", "상황존중", "밀어붙임", "상대무시", "제약무시"

## feedback 규칙
이번 발화에 대한 짧은 코칭 한 줄. 학습자에게 존댓말로, 잘한 점 또는 개선점을 구체적으로.

## 절대 금지 (모든 출력 공통)
- 'ethos/logos/pathos/kairos' 같은 이론·학술 용어, 채점 축의 영어 이름, "설득의 3요소" 같은 프레임워크 명칭을
  characterReply·feedback·actionTags 어디에도 노출하지 말 것. 캐릭터는 그냥 사람으로서 말하고, 코칭도 일상어로 쓴다.

## 출력 형식
반드시 아래 JSON 스키마로만 출력하십시오. 다른 텍스트를 섞지 마십시오.
{
  "axisScores": {
    "emotion": (정수, -5 ~ +5, 감정 읽기),
    "logic": (정수, -5 ~ +5, 논리·근거),
    "trust": (정수, -5 ~ +5, 신뢰 형성),
    "timing": (정수, -5 ~ +5, 타이밍)
  },
  "scoreDelta": (정수, ${diff.minDelta} ~ +${diff.maxDelta}, 위 네 축을 동일 비중으로 합산한 결과),
  "newGauge": (정수, 0~100, ${currentGauge} + scoreDelta를 0~100으로 clamp),
  "newEmotion": ("very_happy" | "happy" | "normal" | "worry" | "angry" — newGauge 기준: ${diff.successLine} 이상 very_happy, ${diff.successLine - 15}~${diff.successLine - 1} happy, ${diff.successLine - 35}~${diff.successLine - 16} normal, ${diff.successLine - 55}~${diff.successLine - 36} worry, 그 미만 angry),
  "actionTags": [문자열 배열],
  "characterReply": "캐릭터의 다음 대사",
  "feedback": "코칭 한 줄"${
    hasAudio
      ? `,
  "tone": {
    "pace": ("fast" | "natural" | "slow"),
    "warmth": ("warm" | "neutral" | "cold"),
    "confidence": ("confident" | "neutral" | "hesitant"),
    "note": "전달 방식에 대한 코칭 한 줄"
  }`
      : ''
  }
}`;
}

const AXIS_KEYS = SCORING_AXES.map((a) => a.key);

const SCORE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    axisScores: {
      type: 'OBJECT',
      properties: Object.fromEntries(AXIS_KEYS.map((k) => [k, { type: 'INTEGER' }])),
      required: AXIS_KEYS,
    },
    scoreDelta: { type: 'INTEGER' },
    newGauge: { type: 'INTEGER' },
    newEmotion: { type: 'STRING', enum: ['very_happy', 'happy', 'normal', 'worry', 'angry'] },
    actionTags: { type: 'ARRAY', items: { type: 'STRING' } },
    characterReply: { type: 'STRING' },
    feedback: { type: 'STRING' },
  },
  required: ['axisScores', 'scoreDelta', 'newEmotion', 'actionTags', 'characterReply', 'feedback'],
};

/** 어조 필드는 오디오가 함께 왔을 때만 스키마에 넣는다 (텍스트 전용 요청은 기존과 완전히 동일) */
const TONE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pace: { type: 'STRING', enum: TONE_DIMENSIONS.pace },
    warmth: { type: 'STRING', enum: TONE_DIMENSIONS.warmth },
    confidence: { type: 'STRING', enum: TONE_DIMENSIONS.confidence },
    note: { type: 'STRING' },
  },
  required: ['pace', 'warmth', 'confidence', 'note'],
};

function scoreSchemaFor(hasAudio) {
  if (!hasAudio) return SCORE_SCHEMA;
  return {
    ...SCORE_SCHEMA,
    properties: { ...SCORE_SCHEMA.properties, tone: TONE_SCHEMA },
    required: [...SCORE_SCHEMA.required, 'tone'],
  };
}

/** 축 점수 정규화 — 누락·비정상 값은 0으로. 반환값은 항상 4축 모두 포함한다. */
function normalizeAxisScores(raw) {
  const out = {};
  for (const key of AXIS_KEYS) {
    const v = Number(raw?.[key]);
    out[key] = Number.isFinite(v) ? clamp(Math.round(v), -5, 5) : 0;
  }
  return out;
}

/** 파싱 실패·API 오류 시 게임이 멈추지 않도록 돌려주는 안전 기본값 */
function fallbackResult(currentGauge, successLine = 85) {
  return {
    axisScores: normalizeAxisScores(null),
    scoreDelta: 0,
    newGauge: currentGauge,
    newEmotion: emotionFor(currentGauge, successLine),
    actionTags: [],
    tone: null,
    characterReply: '음… 잠깐 딴생각을 했네요. 방금 뭐라고 하셨죠?',
    feedback: '일시적인 채점 오류가 발생했어요. 같은 내용을 다시 한번 말해보세요.',
    degraded: true, // 프론트에서 재시도 안내 등에 활용 가능
  };
}

// ─────────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  // 1) 환경변수 확인
  const missing = ['GEMINI_API_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
    .filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`[score] 환경변수 누락: ${missing.join(', ')}`);
    return errorResponse(`서버 설정 오류: 환경변수(${missing.join(', ')})가 설정되지 않았습니다.`, 500);
  }

  // 2) 요청 본문 검증
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400);
  }

  const { roomCode, track, stageId, currentGauge, conversationHistory, userMessage, audio, turnIndex, stallTurns } = body;
  if (!roomCode || !stageId) {
    return errorResponse('roomCode와 stageId는 필수입니다.', 400);
  }
  // 한 방에 두 트랙이 들어 있으므로 어느 트랙의 스테이지인지 알아야 한다
  if (!TRACK_KEYS.includes(track)) {
    return errorResponse(`track은 ${TRACK_KEYS.join(' 또는 ')} 여야 합니다.`, 400);
  }
  if (typeof userMessage !== 'string' || userMessage.trim() === '') {
    return errorResponse('userMessage는 비어 있지 않은 문자열이어야 합니다.', 400);
  }
  if (typeof currentGauge !== 'number' || Number.isNaN(currentGauge)) {
    return errorResponse('currentGauge는 숫자여야 합니다.', 400);
  }
  const gauge = clamp(Math.round(currentGauge), GAUGE_MIN, GAUGE_MAX);

  // 3) Firestore에서 룸 설정 + 스테이지 데이터 조회
  let stage;
  let evalModel = DEFAULT_EVAL_MODEL;
  try {
    const token = await getAccessToken(env);
    const [room, stageDoc] = await Promise.all([
      getDocument(env, token, `rooms/${roomCode}`),
      getDocument(env, token, `rooms/${roomCode}/${stagesCollection(track)}/${stageId}`),
    ]);
    if (!room) return errorResponse(`룸을 찾을 수 없습니다: ${roomCode}`, 404);
    if (!stageDoc) {
      return errorResponse(
        `스테이지를 찾을 수 없습니다: ${roomCode}/${stagesCollection(track)}/${stageId}`,
        404
      );
    }
    stage = stageDoc;
    if (room.settings?.evalModel) evalModel = room.settings.evalModel;
  } catch (err) {
    console.error('[score] Firestore 조회 오류:', err);
    return errorResponse('스테이지 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
  }

  // 4) Gemini 채점 요청 → 파싱
  // 마이크로 말한 발화면 오디오가 함께 온다 — 어조 평가에만 쓰이고 점수에는 영향을 주지 않는다.
  // 형식·용량이 어긋나면 validateAudio가 null을 돌려주고, 텍스트 전용 채점으로 조용히 되돌아간다.
  const voiceAudio = validateAudio(audio);
  // 난이도는 스테이지 문서에서 읽는다 (원본: scripts/stageData.js의 DIFFICULTY_CURVE).
  // 이 기능 이전에 시드된 방에는 difficulty가 없으므로 옛 동작과 같은 값으로 메워진다.
  const diff = readDifficulty(stage);
  // 몇 번째 발화인지 — 없으면 대화 기록에서 센다 (옛 클라이언트 호환)
  const turn = Number.isFinite(Number(turnIndex))
    ? Math.max(1, Math.round(Number(turnIndex)))
    : (conversationHistory || []).filter((m) => m.role === 'user').length + 1;

  const prompt = buildPrompt(
    stage,
    conversationHistory,
    userMessage.trim(),
    gauge,
    Boolean(voiceAudio),
    diff,
    turn,
    Math.max(0, Math.round(Number(stallTurns)) || 0)
  );
  let raw;
  let parsed;
  try {
    raw = await callGemini(
      env,
      evalModel,
      prompt,
      { temperature: 0.3, responseSchema: scoreSchemaFor(Boolean(voiceAudio)) },
      voiceAudio ? [voiceAudio] : []
    );
    parsed = parseGeminiJson(raw);
  } catch (err) {
    console.error('[score] Gemini 채점 실패:', err, raw ? `원문: ${raw.slice(0, 500)}` : '');
    return jsonResponse(fallbackResult(gauge, diff.successLine));
  }

  // 5) 모델 출력 검증·보정 — 점수/감정은 서버에서 확정한다
  // 점수 상·하한은 난이도에서 온다. 모델이 범위를 넘겨도 여기서 잘라내므로
  // "한 방에 뒤집기"는 구조적으로 불가능하다.
  const axisScores = normalizeAxisScores(parsed.axisScores);
  const scoreDelta = clamp(Math.round(Number(parsed.scoreDelta) || 0), diff.minDelta, diff.maxDelta);
  const newGauge = clamp(gauge + scoreDelta, GAUGE_MIN, GAUGE_MAX);
  const newEmotion = emotionFor(newGauge, diff.successLine); // 모델 값 대신 게이지 기준으로 재계산
  const actionTags = Array.isArray(parsed.actionTags)
    ? parsed.actionTags.filter((t) => typeof t === 'string').slice(0, 5)
    : [];
  const characterReply =
    typeof parsed.characterReply === 'string' && parsed.characterReply.trim()
      ? parsed.characterReply.trim()
      : '…….';
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.trim() : '';
  // 오디오를 보낸 턴에만 어조가 실린다. 점수에는 이미 반영되지 않았고, 최종 리포트에서만 쓰인다.
  const tone = voiceAudio ? normalizeTone(parsed.tone) : null;

  return jsonResponse({
    axisScores,
    scoreDelta,
    newGauge,
    newEmotion,
    actionTags,
    tone,
    characterReply,
    feedback,
    // 클라이언트가 성공 연출·종료 판단에 쓴다 (화면이 성공선을 따로 알 필요가 없게)
    successLine: diff.successLine,
    succeeded: newGauge >= diff.successLine,
    // 숨은 의도가 몇 단계까지 열렸는지 — 올라가면 화면에 "단서를 알아냈다"를 띄운다
    revealedLayer: nextLayer(diff, gauge, newGauge),
    hiddenNeedLayerCount: Array.isArray(stage.hiddenNeedLayers) ? stage.hiddenNeedLayers.length : 0,
  });
}

// POST 외 메서드는 405 (POST는 onRequestPost가 우선 처리)
export async function onRequest() {
  return errorResponse('POST 메서드만 지원합니다.', 405);
}
