/**
 * POST /api/report — 최종 설득 분석 리포트 생성 (Cloudflare Pages Function)
 *
 * 입력: { roomCode, playerId, track }  — 리포트는 트랙별로 따로 생성된다
 * 동작:
 *   1) 플레이어의 모든 stageResults(대화 turns 포함)를 Firestore에서 읽음
 *   2) 각 스테이지의 상황·숨은 니즈(정답)도 함께 읽어 맥락 제공 — 서버에서만 사용, 클라이언트에 노출 안 함
 *   3) 전체 대화 로그 + 맥락을 리포트 모델(room.settings.reportModel > env.REPORT_MODEL > 기본값)에 전달
 *   4) temperature 0.7, JSON 스키마 강제로 분석 리포트 생성
 *
 * 리포트 저장은 클라이언트가 받아서 players/{playerId}.finalReports.{track} 에 기록한다.
 */

import {
  jsonResponse,
  errorResponse,
  getAccessToken,
  getDocument,
  listCollection,
  callGemini,
  parseGeminiJson,
} from '../_lib/gcp.js';

const DEFAULT_REPORT_MODEL = 'gemini-3-flash-preview';
// 리포트는 트랙별로 생성한다 — 선택한 트랙의 스테이지·결과만 읽는다.
// (src/common/tracks.js와 이름 규칙을 맞춘다)
const TRACK_KEYS = ['work', 'life'];
const TRACK_LABELS = { work: '업무 설득 트랙', life: '일상 설득 트랙' };
const stagesCollection = (track) => `stages_${track}`;
const resultsCollection = (track) => `stageResults_${track}`;

// ── 4축(설득 기준) 정의 — 화면 표시용 게임 용어 + 작게 병기할 학술 용어 ──
// 학술 용어는 여기 고정 문자열로만 붙는다(Gemini가 임의로 뱉지 못하게). 표시 순서도 이 배열을 따른다.
const AXIS_ORDER = ['logic', 'trust', 'emotion', 'timing'];
const AXIS_META = {
  logic: { label: '논리', academic: 'Logos' },
  trust: { label: '신뢰', academic: 'Ethos' },
  emotion: { label: '감정·공감', academic: 'Pathos' },
  timing: { label: '타이밍', academic: 'Kairos' },
};

/** 축 평균(-5~+5) → 상/중/하 라벨. 정밀 숫자 대신 강약만 노출한다. */
function axisLevel(avg) {
  if (avg >= 1.2) return '상';
  if (avg <= -0.2) return '하';
  return '중';
}

/** 축 평균(-5~+5) → 막대 채움 비율(6~100%). 화면엔 숫자를 안 쓰고 막대 폭으로만 쓴다. */
function axisBar(avg) {
  return Math.max(6, Math.min(100, Math.round(((avg + 2.5) / 5) * 100)));
}

/**
 * 저장된 모든 턴의 4축 점수를 트랙 단위로 집계한다(옵션 A).
 * 반환: [{ key, label, academic, level, bar }] — comment는 이후 Gemini 결과와 합친다.
 */
function computeAxisStats(results) {
  const sums = { logic: 0, trust: 0, emotion: 0, timing: 0 };
  let turnCount = 0;
  for (const r of results) {
    for (const t of r.turns || []) {
      turnCount += 1;
      const a = t.axisScores || {};
      for (const k of AXIS_ORDER) sums[k] += Number(a[k]) || 0;
    }
  }
  return AXIS_ORDER.map((k) => {
    const avg = turnCount ? sums[k] / turnCount : 0;
    return { key: k, label: AXIS_META[k].label, academic: AXIS_META[k].academic, level: axisLevel(avg), bar: axisBar(avg) };
  });
}

// ─────────────────────────────────────────────────────────────
// 프롬프트
// ─────────────────────────────────────────────────────────────

function buildReportPrompt(player, stageBlocks, averageScore, track) {
  return `당신은 설득 커뮤니케이션 코치입니다. 학습자가 설득 훈련 게임에서 남긴 전체 대화 기록을 분석해,
개인별 설득 강점·약점과 제언을 담은 최종 리포트를 작성합니다.

## 학습자
- 이름: ${player.name} (${player.affiliation})
- 훈련 트랙: ${TRACK_LABELS[track]}
- 완료한 스테이지 수: ${stageBlocks.length}개
- 평균 점수: ${averageScore}점 (100점 만점, 85점 = 설득 성공 기준선)

## 게임 규칙 참고
- 각 스테이지에서 학습자는 AI 캐릭터를 설득한다. 발화마다 -15~+20점이 오르내린다.
- 각 캐릭터에게는 "표면 니즈"(겉으로 말하는 것)와 "숨은 니즈"(진짜 원하는 것)가 있고,
  숨은 니즈를 파악해 대응하는 것이 고득점 핵심이다.
- 채점은 네 가지를 **똑같은 비중(각 25%)**으로 본다:
  ① 감정 읽기 — 상대의 감정·상태를 알아차리고 인정했는가
  ② 논리·근거 — 구체적 근거·대안·리스크 통제안을 제시했는가
  ③ 신뢰 형성 — 상대의 입장·기여·제약을 존중하고 지킬 수 있는 말을 했는가
  ④ 타이밍 — 대화 흐름에 맞는 때에 꺼낸 말인가

## 스테이지별 대화 기록
${stageBlocks.join('\n\n')}

## 분석 지침 (매우 중요)
1. **반드시 학습자의 실제 발화를 그대로 인용해 근거로 삼을 것.** 위 대화 기록에 없는 문장을 지어내면 절대 안 된다.
   인용할 때는 발화 전체 또는 핵심 부분을 원문 그대로 쓸 것.
2. "주로 ~하는 방식으로 설득하는 경향이 보여요"처럼 **관찰된 행동 패턴을 서술**할 것.
   여러 스테이지에서 반복된 패턴이면 그 점을 짚어줄 것.
3. 그 방식이 **효과적이었던 상황**(점수가 오른 턴)과 **아쉬웠던 상황**(점수가 깎인 턴)을 구분해 설명할 것.
   scoreDelta와 게이지 변화를 근거로 활용할 것.
4. "소방관형", "집사형" 같은 **유형 라벨은 절대 쓰지 말 것.** 행동과 근거 중심으로만 서술.
4-1. **학술 용어를 절대 노출하지 말 것.** "에토스", "파토스", "로고스", "라포", "프레이밍" 같은
   이론 용어나 축 이름("감정 읽기 축", "논리·근거 축")을 그대로 쓰지 말고,
   **무엇을 해서 왜 통했는지 풀어서** 설명할 것.
   - 나쁜 예: "파토스에 강점이 있습니다", "감정 읽기 축 점수가 높습니다"
   - 좋은 예: "상대의 감정을 먼저 읽어준 점이 효과적이었어요",
             "근거와 함께 리스크를 막을 방법까지 제시한 점이 결정적이었어요"
5. 톤: 따뜻하고 격려하되, 아쉬운 점은 솔직하게. 학습자에게 존댓말.
6. strengths와 weaknesses는 각각 2~3개. evidence는 반드시 실제 발화 인용.
7. recommendations는 구체적인 행동 제언 2~3개 (예: "요청하기 전에 상대의 시간 제약부터 확인해 보세요").
8. axisFeedback: 아래 네 관점 각각에 대해 학습자에게 **존댓말 한 문장**으로, 이번 대화에서 잘한 점 또는
   아쉬운 점을 구체적으로 코멘트할 것. (앞의 4-1 규칙대로 학술 용어·축 이름은 절대 노출하지 말 것.)
   - logic  : 구체적 근거·대안·리스크를 막을 방법을 얼마나 잘 폈는지
   - trust  : 상대의 입장·기여·제약을 존중하고 지킬 수 있는 말로 신뢰를 쌓았는지
   - emotion: 상대의 감정·상태를 먼저 읽고 인정해 주었는지
   - timing : 그 말을 꺼낸 때가 대화 흐름에 맞았는지

## 등급(overallGrade) 기준
평균 점수 기준: 85 이상 A+, 75~84 A, 65~74 B+, 55~64 B, 45~54 C+, 45 미만 C

## 출력 형식
반드시 아래 JSON 스키마로만 출력하십시오.
{
  "overallGrade": "A+" | "A" | "B+" | "B" | "C+" | "C",
  "averageScore": ${averageScore},
  "summary": "2~3문장 총평",
  "observedStyle": "이 학습자가 주로 쓰는 설득 방식 서술 (3~5문장, 유형 라벨 없이)",
  "strengths": [ { "point": "강점", "evidence": "실제 발화 인용", "effect": "어떤 효과가 있었는지" } ],
  "weaknesses": [ { "point": "아쉬운 점", "evidence": "실제 발화 인용", "suggestion": "개선 제언" } ],
  "axisFeedback": {
    "logic": "근거·리스크 관점 한 줄 코멘트",
    "trust": "신뢰·존중 관점 한 줄 코멘트",
    "emotion": "감정·공감 관점 한 줄 코멘트",
    "timing": "타이밍 관점 한 줄 코멘트"
  },
  "recommendations": ["구체적 제언 2~3개"],
  "closingComment": "격려 한 마디"
}`;
}

const REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    overallGrade: { type: 'STRING', enum: ['A+', 'A', 'B+', 'B', 'C+', 'C'] },
    averageScore: { type: 'NUMBER' },
    summary: { type: 'STRING' },
    observedStyle: { type: 'STRING' },
    strengths: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          point: { type: 'STRING' },
          evidence: { type: 'STRING' },
          effect: { type: 'STRING' },
        },
        required: ['point', 'evidence', 'effect'],
      },
    },
    weaknesses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          point: { type: 'STRING' },
          evidence: { type: 'STRING' },
          suggestion: { type: 'STRING' },
        },
        required: ['point', 'evidence', 'suggestion'],
      },
    },
    axisFeedback: {
      type: 'OBJECT',
      properties: {
        logic: { type: 'STRING' },
        trust: { type: 'STRING' },
        emotion: { type: 'STRING' },
        timing: { type: 'STRING' },
      },
      required: ['logic', 'trust', 'emotion', 'timing'],
    },
    recommendations: { type: 'ARRAY', items: { type: 'STRING' } },
    closingComment: { type: 'STRING' },
  },
  required: [
    'overallGrade',
    'summary',
    'observedStyle',
    'strengths',
    'weaknesses',
    'axisFeedback',
    'recommendations',
    'closingComment',
  ],
};

/** 스테이지 한 개의 대화 기록을 프롬프트 블록으로 만든다 */
function buildStageBlock(stage, result) {
  const turns = (result.turns || [])
    .map((t, i) => {
      const delta = t.scoreDelta > 0 ? `+${t.scoreDelta}` : `${t.scoreDelta}`;
      const tags = (t.actionTags || []).join(', ');
      const a = t.axisScores;
      // 축 점수는 분석 근거로만 쓰고, 리포트 문장에는 축 이름을 그대로 노출하지 않는다
      const axes = a
        ? `\n    → 항목별: 감정 읽기 ${a.emotion ?? 0} / 논리·근거 ${a.logic ?? 0} / 신뢰 형성 ${a.trust ?? 0} / 타이밍 ${a.timing ?? 0}`
        : '';
      return `  턴${i + 1} 학습자: "${t.userMessage}"
    → 점수 변화 ${delta} (게이지 ${t.gaugeAfter})${tags ? `, 행동 태그: ${tags}` : ''}${axes}
    캐릭터: "${t.characterReply}"`;
    })
    .join('\n');

  return `### [${stage?.title || result.id}] — 최종 점수 ${result.stageScore}점
- 상황: ${stage?.situation || '(정보 없음)'}
- 캐릭터: ${stage?.characterName || '-'} / 표면 니즈: ${stage?.surfaceNeed || '-'}
- 숨은 니즈(정답): ${stage?.hiddenNeed || '-'}${stage?.persuasionGoal ? `\n- 설득 목표: ${stage.persuasionGoal}` : ''}
${turns || '  (대화 기록 없음 — 점수만 저장됨)'}`;
}

// ─────────────────────────────────────────────────────────────
// 핸들러
// ─────────────────────────────────────────────────────────────

export async function onRequestPost({ request, env }) {
  const missing = ['GEMINI_API_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
    .filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`[report] 환경변수 누락: ${missing.join(', ')}`);
    return errorResponse(`서버 설정 오류: 환경변수(${missing.join(', ')})가 설정되지 않았습니다.`, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('요청 본문이 올바른 JSON이 아닙니다.', 400);
  }
  const { roomCode, playerId, track } = body;
  if (!roomCode || !playerId) {
    return errorResponse('roomCode와 playerId는 필수입니다.', 400);
  }
  if (!TRACK_KEYS.includes(track)) {
    return errorResponse(`track은 ${TRACK_KEYS.join(' 또는 ')} 여야 합니다.`, 400);
  }

  // 1) Firestore에서 플레이어·결과·스테이지 데이터 조회
  let player;
  let results;
  let stages;
  let reportModel = env.REPORT_MODEL || DEFAULT_REPORT_MODEL;
  try {
    const token = await getAccessToken(env);
    const [room, playerDoc, resultDocs, stageDocs] = await Promise.all([
      getDocument(env, token, `rooms/${roomCode}`),
      getDocument(env, token, `rooms/${roomCode}/players/${playerId}`),
      listCollection(env, token, `rooms/${roomCode}/players/${playerId}/${resultsCollection(track)}`),
      listCollection(env, token, `rooms/${roomCode}/${stagesCollection(track)}`),
    ]);
    if (!room) return errorResponse(`룸을 찾을 수 없습니다: ${roomCode}`, 404);
    if (!playerDoc) return errorResponse(`플레이어를 찾을 수 없습니다: ${playerId}`, 404);
    player = playerDoc;
    results = resultDocs;
    stages = stageDocs;
    // 모델 우선순위: room.settings.reportModel > env.REPORT_MODEL > 기본값
    if (room.settings?.reportModel) reportModel = room.settings.reportModel;
  } catch (err) {
    console.error('[report] Firestore 조회 오류:', err);
    return errorResponse('데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
  }

  if (!results.length) {
    return errorResponse('완료한 스테이지가 없어 리포트를 만들 수 없습니다.', 400);
  }
  const totalTurns = results.reduce((n, r) => n + (r.turns?.length || 0), 0);
  if (totalTurns === 0) {
    return errorResponse('대화 기록(turns)이 없어 리포트를 만들 수 없습니다. 스테이지를 다시 플레이해 주세요.', 400);
  }

  // 2) 프롬프트 구성 (스테이지 order 순 정렬)
  const stageById = Object.fromEntries(stages.map((s) => [s.id, s]));
  results.sort((a, b) => (stageById[a.id]?.order || 99) - (stageById[b.id]?.order || 99));
  const averageScore = Math.round(results.reduce((sum, r) => sum + (r.stageScore || 0), 0) / results.length);
  const stageBlocks = results.map((r) => buildStageBlock(stageById[r.id], r));
  const prompt = buildReportPrompt(player, stageBlocks, averageScore, track);

  // 3) Gemini 리포트 생성
  let raw;
  let parsed;
  try {
    raw = await callGemini(env, reportModel, prompt, { temperature: 0.7, responseSchema: REPORT_SCHEMA });
    parsed = parseGeminiJson(raw);
  } catch (err) {
    console.error('[report] Gemini 리포트 생성 실패:', err, raw ? `원문: ${raw.slice(0, 500)}` : '');
    return errorResponse('리포트 생성에 실패했어요. 잠시 후 다시 시도해 주세요.', 502);
  }

  // 4) 검증·보정 — 평균 점수와 4축 강약은 서버 계산값으로 확정
  const asArray = (v) => (Array.isArray(v) ? v : []);
  // 4축 강약(막대·상중하)은 저장된 점수로 계산하고(옵션 A), 한 줄 코멘트만 Gemini 결과를 붙인다(옵션 B).
  // 학술 용어(academic)는 서버 고정값이라 모델이 잘못 뱉을 수 없다.
  const axisFeedback = parsed.axisFeedback || {};
  const axes = computeAxisStats(results).map((a) => ({
    ...a,
    comment: typeof axisFeedback[a.key] === 'string' ? axisFeedback[a.key].trim() : '',
  }));
  const report = {
    overallGrade: typeof parsed.overallGrade === 'string' ? parsed.overallGrade : 'B',
    averageScore, // 모델 출력 대신 서버 계산값
    summary: parsed.summary || '',
    observedStyle: parsed.observedStyle || '',
    axes, // 4축 평가 (서버 강약 + Gemini 코멘트)
    strengths: asArray(parsed.strengths).slice(0, 4),
    weaknesses: asArray(parsed.weaknesses).slice(0, 4),
    recommendations: asArray(parsed.recommendations).filter((r) => typeof r === 'string').slice(0, 4),
    closingComment: parsed.closingComment || '',
    stageScores: results.map((r) => ({
      stageId: r.id,
      title: stageById[r.id]?.title || r.id,
      order: stageById[r.id]?.order || 0,
      score: r.stageScore || 0,
    })),
    track,
    generatedAt: new Date().toISOString(),
  };

  return jsonResponse({ report });
}

// POST 외 메서드는 405
export async function onRequest() {
  return errorResponse('POST 메서드만 지원합니다.', 405);
}
