/**
 * tracks.js — 트랙 정의 (학습자·관리자 화면 공용)
 *
 * 한 방(rooms/{code})에는 두 트랙이 모두 들어 있고, 학습자가 입장 후 직접 고른다.
 * 트랙별 데이터는 서브컬렉션 이름에 트랙 키를 붙여 완전히 분리한다:
 *
 *   rooms/{code}/stages_work        rooms/{code}/stages_life
 *   rooms/{code}/players/{id}/stageResults_work   ...stageResults_life
 *   players/{id}.progress.work      players/{id}.progress.life
 *   players/{id}.finalReports.work  players/{id}.finalReports.life
 *
 * 두 트랙은 잠금·점수·리포트가 서로 영향을 주지 않는다.
 */

export const TRACKS = {
  work: {
    key: 'work',
    label: '업무 설득 트랙',
    shortLabel: '업무',
    emoji: '💼',
    description: '직장 상황 설득',
    // 트랙 선택 카드에 쓰는 문구 (책의 "장" 은유)
    cardTitle: '업무의 장',
    cardDesc: '일터에서 마음을 움직이기',
  },
  life: {
    key: 'life',
    label: '일상 설득 트랙',
    shortLabel: '일상',
    emoji: '🏠',
    description: '생활 속 설득',
    cardTitle: '일상의 장',
    cardDesc: '가까운 사람을 설득하기',
  },
};

export const TRACK_KEYS = Object.keys(TRACKS);
export const DEFAULT_TRACK = 'work';

/**
 * 트랙 선택 화면에 보여줄 순서 — 일상 트랙을 먼저(왼쪽에) 노출한다.
 * 데이터 구조(TRACK_KEYS)의 순서는 CSV·관리자 표에서 쓰이므로 건드리지 않는다.
 */
export const TRACK_SELECT_ORDER = ['life', 'work'];

/** 유효한 트랙 키인지 */
export const isTrack = (track) => TRACK_KEYS.includes(track);

/** 트랙 키를 안전하게 정규화 — 모르는 값이면 기본 트랙 */
export const normalizeTrack = (track) => (isTrack(track) ? track : DEFAULT_TRACK);

/** 표시용 라벨 */
export function trackLabel(track, { short = false } = {}) {
  const meta = TRACKS[normalizeTrack(track)];
  return short ? meta.shortLabel : meta.label;
}

/** 트랙별 서브컬렉션 이름 — 경로를 문자열로 조립하는 곳은 반드시 이 함수를 쓸 것 */
export const stagesCollection = (track) => `stages_${normalizeTrack(track)}`;
export const resultsCollection = (track) => `stageResults_${normalizeTrack(track)}`;
