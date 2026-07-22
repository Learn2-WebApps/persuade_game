/**
 * level.js — "설득 레벨" 산출
 *
 * ⚠️ 현재 아웃트로 대본에는 레벨 장면이 없어 어디서도 호출하지 않는다 (보관용).
 *    아웃트로나 종료 화면에 레벨을 다시 넣고 싶으면 computePersuasionLevel()의 결과를
 *    컷신 vars({level, title, comment})로 넘기면 된다.
 *
 * 채점 로직은 건드리지 않는다. 이미 저장된 데이터를 읽어서 요약만 한다.
 *   stageResults_{track}/{stageId}.turns[].axisScores  (각 축 -5 ~ +5)
 *
 * 산출 방식:
 *   1) 두 트랙 전체 턴의 축별 점수를 누적 → axisTotals
 *   2) 턴당 평균(grandTotal / turnCount)으로 레벨 판정
 *      (누적 합만 쓰면 말을 많이 할수록 레벨이 올라가므로 턴 수로 정규화한다)
 *   3) 누적이 가장 높은 축 = 강점, 가장 낮은 축 = 약점
 *
 * 디브리핑 원칙에 맞춰 축 이름은 "감정을 먼저 읽어주는" 식으로 풀어서 쓴다.
 */

import { fetchStageResults } from '../common/firebase.js';
import { TRACK_KEYS } from '../common/tracks.js';

const AXES = ['emotion', 'logic', 'trust', 'timing'];

/** 축별 강점 문장 (레벨 코멘트용) */
const AXIS_STRENGTH = {
  emotion: '상대의 감정을 먼저 읽어주는 것',
  logic: '근거와 대안을 갖춰 말하는 것',
  trust: '상대의 입장을 존중해 믿음을 쌓는 것',
  timing: '말을 꺼내는 때를 고르는 것',
};

/** 축별 약점 문장 */
const AXIS_WEAKNESS = {
  emotion: '상대의 마음을 먼저 살피는 일',
  logic: '주장에 근거를 붙이는 일',
  trust: '상대의 처지를 존중해 신뢰를 얻는 일',
  timing: '말을 꺼낼 때를 고르는 일',
};

/** 턴당 평균 점수 → 레벨·칭호 */
const LEVELS = [
  { min: 12, level: 'LV.5', title: '설득의 왕' },
  { min: 8, level: 'LV.4', title: '마음을 여는 사람' },
  { min: 4, level: 'LV.3', title: '대화를 이끄는 사람' },
  { min: 0, level: 'LV.2', title: '한 걸음 나아간 사람' },
  { min: -Infinity, level: 'LV.1', title: '이제 막 책을 편 사람' },
];

/**
 * 두 트랙의 저장된 결과를 읽어 레벨 정보를 만든다.
 * @returns {Promise<{level, title, comment, axisTotals, turnCount, avgPerTurn, best, worst}>}
 */
export async function computePersuasionLevel(roomCode, playerId) {
  const axisTotals = Object.fromEntries(AXES.map((a) => [a, 0]));
  let turnCount = 0;

  for (const track of TRACK_KEYS) {
    let results = {};
    try {
      results = await fetchStageResults(roomCode, playerId, track);
    } catch (err) {
      console.error(`[level] ${track} 결과 로드 실패:`, err);
      continue;
    }
    for (const result of Object.values(results)) {
      for (const turn of result.turns || []) {
        turnCount += 1;
        for (const axis of AXES) {
          axisTotals[axis] += Number(turn.axisScores?.[axis]) || 0;
        }
      }
    }
  }

  const grandTotal = AXES.reduce((sum, a) => sum + axisTotals[a], 0);
  const avgPerTurn = turnCount > 0 ? grandTotal / turnCount : 0;

  // 대화 기록이 없으면(옛 데이터 등) 레벨을 단정하지 않는다
  if (turnCount === 0) {
    return {
      level: 'LV.?',
      title: '기록이 남지 않은 사람',
      comment: '이번엔 대화 기록이 남지 않아, 어떤 설득이었는지 읽어낼 수 없었다.',
      axisTotals,
      turnCount,
      avgPerTurn,
      best: null,
      worst: null,
    };
  }

  const { level, title } = LEVELS.find((l) => avgPerTurn >= l.min);

  const sorted = [...AXES].sort((a, b) => axisTotals[b] - axisTotals[a]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  // 축 점수가 전부 같으면(예: 채점이 폴백으로 처리돼 전부 0) 강점·약점을 단정할 근거가 없다.
  // 배열 순서상 앞선 축을 강점이라고 말해버리면 사실이 아닌 코멘트가 나가므로 중립 문장을 쓴다.
  const hasSpread = axisTotals[best] !== axisTotals[worst];

  const comment = !hasSpread
    ? '어느 한쪽으로 치우치지 않은 걸음이었다. 다음 장에서는 자네만의 무기를 벼려 보게.'
    : `${AXIS_STRENGTH[best]}에 특히 힘이 있었고, ${AXIS_WEAKNESS[worst]}은 조금 더 벼려도 좋겠다.`;

  return {
    level,
    title,
    comment,
    axisTotals,
    turnCount,
    avgPerTurn,
    best: hasSpread ? best : null,
    worst: hasSpread ? worst : null,
  };
}
