/**
 * difficulty.js — 스테이지 난이도 읽기 (플레이 화면·브리핑 공용)
 *
 * 난이도 값은 스테이지 문서(rooms/{code}/stages_{track}/{id}.difficulty)에 들어 있고,
 * 원본은 scripts/stageData.js의 DIFFICULTY_CURVE다. 채점 서버(functions/api/score.js)도
 * 같은 문서를 읽으므로 값이 어긋날 일이 없다.
 *
 * ⚠️ 이 파일은 "없을 때 안전하게 메우는" 역할만 한다.
 *    난이도 곡선 자체를 바꾸려면 scripts/stageData.js를 고치고 다시 시드할 것.
 */

/**
 * 난이도가 없는 스테이지(이 기능 이전에 시드된 방, 내장 데모 데이터)를 위한 기본값.
 * 옛 동작과 같은 값으로 둬서, 다시 시드하지 않은 방도 전처럼 돌아간다.
 */
const LEGACY_DEFAULT = {
  level: 3,
  startGauge: 50,
  successLine: 85,
  resistance: 3,
  targetTurns: 10,
  breakdownLine: 10,
  maxDelta: 20,
  minDelta: -15,
  floorBonus: 2,
  timeLimit: null, // null이면 룸 settings 값을 쓴다
  maxMessages: null,
};

const int = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/**
 * 스테이지에서 난이도를 꺼낸다. 빠진 항목은 기본값으로 메운다.
 * @param {object} stage
 * @returns {object} LEGACY_DEFAULT와 같은 형태 (timeLimit·maxMessages는 null일 수 있음)
 */
export function readDifficulty(stage) {
  const d = stage?.difficulty || {};
  return {
    level: int(d.level, LEGACY_DEFAULT.level),
    startGauge: int(d.startGauge, LEGACY_DEFAULT.startGauge),
    successLine: int(d.successLine, LEGACY_DEFAULT.successLine),
    resistance: int(d.resistance, LEGACY_DEFAULT.resistance),
    targetTurns: int(d.targetTurns, LEGACY_DEFAULT.targetTurns),
    breakdownLine: int(d.breakdownLine, LEGACY_DEFAULT.breakdownLine),
    maxDelta: int(d.maxDelta, LEGACY_DEFAULT.maxDelta),
    minDelta: int(d.minDelta, LEGACY_DEFAULT.minDelta),
    floorBonus: int(d.floorBonus, LEGACY_DEFAULT.floorBonus),
    timeLimit: d.timeLimit == null ? null : int(d.timeLimit, null),
    maxMessages: d.maxMessages == null ? null : int(d.maxMessages, null),
  };
}

/** 난이도 표시용 라벨 — 브리핑·맵에서 학습자에게 보여준다 */
export const LEVEL_LABELS = {
  1: '입문',
  2: '쉬움',
  3: '보통',
  4: '어려움',
  5: '최난관',
};

export const levelLabel = (level) => LEVEL_LABELS[level] || '보통';

/**
 * 감정 구간 — 성공선을 기준으로 상대적으로 잡는다.
 * (예전에는 85 고정이라, 성공선이 75인 스테이지에서도 85를 넘어야 가장 밝은 표정이 나왔다)
 * 채점 서버의 emotionFor와 같은 규칙을 쓴다.
 */
export function emotionFor(gauge, successLine) {
  const line = Number(successLine) || 85;
  if (gauge >= line) return 'very_happy';
  if (gauge >= line - 15) return 'happy';
  if (gauge >= line - 35) return 'normal';
  if (gauge >= line - 55) return 'worry';
  return 'angry';
}
