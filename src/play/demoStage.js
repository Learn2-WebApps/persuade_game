/**
 * demoStage.js — Firebase 웹 config가 아직 없거나 Firestore 읽기에 실패했을 때
 * 화면 테스트용으로 쓰는 내장 폴백 데이터 (seed.js의 stage1과 동일한 공개 필드만).
 *
 * ※ 채점(/api/score)은 서버가 서비스 계정으로 Firestore를 직접 읽으므로,
 *    이 폴백 상태에서도 실제 채점은 정상 동작한다.
 */

export const DEMO_SETTINGS = {
  stageTimeLimit: 300, // 초
  maxMessagesPerStage: 15,
};

export const DEMO_STAGE1 = {
  order: 1,
  title: '바쁜 선배에게 5분 얻어내기',
  characterName: '한 과장',
  characterType: 'internal',
  introDialogue: '아, 지금 좀 정신이 없어서… 급한 거 아니면 이따 얘기하면 안 될까요?',
};
