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
const DELTA_MIN = -15;
const DELTA_MAX = 20;
const HISTORY_LIMIT = 30; // 프롬프트에 포함할 최근 대화 수

/** 게이지 값 → 감정 상태. happy(80+) / normal(50~79) / worry(30~49) / angry(<30) */
function emotionFor(gauge) {
  if (gauge >= 80) return 'happy';
  if (gauge >= 50) return 'normal';
  if (gauge >= 30) return 'worry';
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

function buildPrompt(stage, conversationHistory, userMessage, currentGauge) {
  const history = (conversationHistory || [])
    .slice(-HISTORY_LIMIT)
    .map((m) => `${m.role === 'user' ? '학습자' : stage.characterName}: ${m.text}`)
    .join('\n');

  const examples = formatScoringExamples(stage.scoringExamples);
  const axisGuide = SCORING_AXES.map((a, i) => `${i + 1}. ${a.label} (25%) — ${a.guide}`).join('\n');
  const clue = stage.hiddenNeedClue
    ? `\n- 숨은 니즈 단서 대사 (대화 중 자연스럽게 흘릴 것): "${stage.hiddenNeedClue}"`
    : '';
  // 초기 태도·설득 목표는 선택 필드다 — 없으면 줄 자체를 빼서 "undefined"가 새지 않게 한다
  const stance = stage.initialStance ? `\n- 캐릭터의 초기 태도: ${stage.initialStance}` : '';
  const goal =
    stage.persuasionGoal ||
    `게이지 85 도달 — ${stage.characterName}이(가) 경계를 풀고 학습자의 말을 받아들이는 반응을 보이게 하기`;

  return `당신은 설득 훈련 게임의 채점자이자, 게임 속 캐릭터 "${stage.characterName}"의 역할 연기자입니다.
학습자의 이번 발화를 채점하고, 캐릭터로서 다음 대사를 만들어야 합니다.

## 시나리오
- 상황: ${stage.situation}
- 캐릭터: ${stage.characterName} (${describeCharacterType(stage.characterType)})${stance}
- 표면 니즈 (캐릭터가 겉으로 말하는 것): ${stage.surfaceNeed}
- 숨은 니즈 (캐릭터가 진짜 원하는 것, 학습자가 파악해야 함): ${stage.hiddenNeed}${clue}
- 설득 목표: ${goal}
- 캐릭터가 자주 쓰는 저항 멘트: ${(stage.resistancePoints || []).map((r) => `"${r}"`).join(', ')}

## 지금까지의 대화
${history || '(첫 발화입니다)'}

## 학습자의 이번 발화
"${userMessage}"

## 현재 설득 게이지
${currentGauge} / 100 (85 이상이면 설득 성공 기준선)

## 채점 기준 — 4축 균등 (각 25%)
학습자의 이번 발화가 아래 네 축 각각에 어떻게 기여했는지 먼저 축별로 판단한 뒤,
네 축을 **동일한 비중으로 합산**해 최종 scoreDelta를 산출하십시오.

${axisGuide}

축별 판단 방법:
- 각 축을 -5 ~ +5 로 평가한다. (해당 축을 잘 살렸으면 +, 해쳤으면 -, 이번 발화와 무관하면 0)
- 네 축 점수를 모두 더한 값(-20 ~ +20)을 기준으로 scoreDelta를 정한다. 한 축이 아무리 뛰어나도
  나머지 세 축이 0이면 큰 가점이 될 수 없다 — 4축이 고르게 살아야 고득점이다.
- 숨은 니즈를 짚어낸 발화는 대개 여러 축에서 동시에 높게 평가된다.
- 무의미하거나 대화와 무관한 발화: 0 또는 소폭 감점.
- 최종 scoreDelta는 정수, -15 ~ +20 범위로 맞춘다.

## 이 스테이지의 채점 참고 예시
각 예시 뒤 대괄호는 그 발화가 주로 살린 축이다.
${examples || '(예시 없음 — 위 4축 기준으로만 판단하십시오)'}

## characterReply 작성 규칙
- ${stage.characterName}의 초기 태도와 게이지 변화를 반영해, 자연스럽게 밀고 당기는 대화가 되도록 쓸 것.
- 게이지가 낮으면 저항 멘트처럼 방어적으로, 게이지가 오를수록 조금씩 마음이 열리는 톤으로.
- 게이지가 85 이상이 되면 설득 목표에 명시된 반응에 가까워지도록.
- 한국어 구어체 1~3문장. 캐릭터를 벗어난 설명이나 채점 언급은 절대 하지 말 것.

## actionTags 규칙
학습자의 이번 발화에 해당하는 행동 태그를 0~3개 고를 것.
예시: "공감", "숨은니즈파악", "근거제시", "해결책제안", "질문", "상황존중", "밀어붙임", "상대무시", "제약무시"

## feedback 규칙
이번 발화에 대한 짧은 코칭 한 줄. 학습자에게 존댓말로, 잘한 점 또는 개선점을 구체적으로.

## 출력 형식
반드시 아래 JSON 스키마로만 출력하십시오. 다른 텍스트를 섞지 마십시오.
{
  "axisScores": {
    "emotion": (정수, -5 ~ +5, 감정 읽기),
    "logic": (정수, -5 ~ +5, 논리·근거),
    "trust": (정수, -5 ~ +5, 신뢰 형성),
    "timing": (정수, -5 ~ +5, 타이밍)
  },
  "scoreDelta": (정수, -15 ~ +20, 위 네 축을 동일 비중으로 합산한 결과),
  "newGauge": (정수, 0~100, ${currentGauge} + scoreDelta를 0~100으로 clamp),
  "newEmotion": ("happy" | "normal" | "worry" | "angry" — newGauge 기준: 80 이상 happy, 50~79 normal, 30~49 worry, 30 미만 angry),
  "actionTags": [문자열 배열],
  "characterReply": "캐릭터의 다음 대사",
  "feedback": "코칭 한 줄"
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
    newEmotion: { type: 'STRING', enum: ['happy', 'normal', 'worry', 'angry'] },
    actionTags: { type: 'ARRAY', items: { type: 'STRING' } },
    characterReply: { type: 'STRING' },
    feedback: { type: 'STRING' },
  },
  required: ['axisScores', 'scoreDelta', 'newEmotion', 'actionTags', 'characterReply', 'feedback'],
};

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
function fallbackResult(currentGauge) {
  return {
    axisScores: normalizeAxisScores(null),
    scoreDelta: 0,
    newGauge: currentGauge,
    newEmotion: emotionFor(currentGauge),
    actionTags: [],
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

  const { roomCode, track, stageId, currentGauge, conversationHistory, userMessage } = body;
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
  const prompt = buildPrompt(stage, conversationHistory, userMessage.trim(), gauge);
  let raw;
  let parsed;
  try {
    raw = await callGemini(env, evalModel, prompt, { temperature: 0.3, responseSchema: SCORE_SCHEMA });
    parsed = parseGeminiJson(raw);
  } catch (err) {
    console.error('[score] Gemini 채점 실패:', err, raw ? `원문: ${raw.slice(0, 500)}` : '');
    return jsonResponse(fallbackResult(gauge));
  }

  // 5) 모델 출력 검증·보정 — 점수/감정은 서버에서 확정한다
  const axisScores = normalizeAxisScores(parsed.axisScores);
  const scoreDelta = clamp(Math.round(Number(parsed.scoreDelta) || 0), DELTA_MIN, DELTA_MAX);
  const newGauge = clamp(gauge + scoreDelta, GAUGE_MIN, GAUGE_MAX);
  const newEmotion = emotionFor(newGauge); // 모델 값 대신 게이지 기준으로 재계산 (일관성 보장)
  const actionTags = Array.isArray(parsed.actionTags)
    ? parsed.actionTags.filter((t) => typeof t === 'string').slice(0, 5)
    : [];
  const characterReply =
    typeof parsed.characterReply === 'string' && parsed.characterReply.trim()
      ? parsed.characterReply.trim()
      : '…….';
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.trim() : '';

  return jsonResponse({ axisScores, scoreDelta, newGauge, newEmotion, actionTags, characterReply, feedback });
}

// POST 외 메서드는 405 (POST는 onRequestPost가 우선 처리)
export async function onRequest() {
  return errorResponse('POST 메서드만 지원합니다.', 405);
}
