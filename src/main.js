/**
 * main.js — 앱 진입점 + 화면 전환 총괄
 *
 * 흐름: 입장(Entry) → [오프닝 컷신] → 트랙 선택(TrackSelect) → 스테이지 맵(StageMap)
 *       → 상황 브리핑(Briefing) → [START] → 대화(Play) → 점수 저장
 *       → (트랙의 마지막 스테이지였다면) 설득 리포트 → 트랙 선택
 *       → [게임 마치기] → [아웃트로 컷신] → 종료 화면
 *
 * 서점 액자 스토리: 오프닝은 입장 직후 1회 재생하고, 아웃트로는 학습자가
 * 트랙 선택 화면에서 [게임 마치기]를 누를 때 재생한다 (마무리 시점은 학습자가 고른다).
 * 오프닝 재생 여부는 sessionStorage에 방·플레이어 단위로 기록한다 (탭을 닫으면 초기화).
 *
 * 트랙 고정: 한 트랙에 들어가면 그 트랙을 다 풀기 전까지 다른 트랙으로 갈 수 없다.
 * (맵에는 트랙 전환 버튼이 없고, 트랙을 마치면 리포트를 거쳐 트랙 선택으로 돌아온다)
 *
 * 새로고침 시 sessionStorage의 입장 정보로 이어한다
 * (트랙까지 골라둔 상태면 맵부터, 아니면 트랙 선택 화면부터).
 */

import './style.css';
import { initEntryScreen } from './entry/entryScreen.js';
import { initTrackSelectScreen } from './track/trackSelectScreen.js';
import { initStageMapScreen } from './map/stageMapScreen.js';
import { initBriefingScreen } from './briefing/briefingScreen.js';
import { initPlayScreen } from './play/playScreen.js';
import { initReportScreen } from './report/reportScreen.js';
import { initCutsceneScreen } from './cutscene/cutsceneScreen.js';
import { initEndingScreen } from './ending/endingScreen.js';
import { OPENING_SCENES, OUTRO_SCENES } from './cutscene/cutsceneData.js';
import { saveStageResult } from './common/firebase.js';
import { isTrack, normalizeTrack } from './common/tracks.js';
import { loadSession, saveSession, updateSession, clearSession } from './common/session.js';

// ── 컷신 재생 기록 (방·플레이어 단위) ─────────────────────────
const cutsceneKey = (kind, s) => `persuade.cutscene.${kind}.${s.roomCode}.${s.playerId}`;
const hasSeenCutscene = (kind, s) => sessionStorage.getItem(cutsceneKey(kind, s)) === '1';
const markCutsceneSeen = (kind, s) => sessionStorage.setItem(cutsceneKey(kind, s), '1');

function showEntry() {
  initEntryScreen({
    onEntered(session) {
      // 입장 시점에는 트랙 미선택 — 오프닝 컷신을 보고 나서 고른다
      saveSession(session);
      showOpening();
    },
  });
}

/** 오프닝 컷신 — 서점에서 "설득의 정석"을 펼치기까지. 이미 봤으면 건너뛴다. */
function showOpening() {
  const session = loadSession();
  if (!session) return showEntry();
  if (hasSeenCutscene('opening', session)) return showTrackSelect();

  initCutsceneScreen({
    scenes: OPENING_SCENES,
    vars: { name: session.name },
    onDone() {
      markCutsceneSeen('opening', session);
      showTrackSelect();
    },
  });
}

/** 아웃트로 컷신 — 트랙 선택 화면의 [게임 마치기]에서만 재생된다. */
function showOutro() {
  const session = loadSession();
  if (!session) return showEntry();

  initCutsceneScreen({
    scenes: OUTRO_SCENES,
    vars: { name: session.name },
    onDone: showEnding,
  });
}

/** 종료 화면 — 여기서 트랙 선택으로 돌아가면 남은 트랙·리포트를 계속 볼 수 있다. */
function showEnding() {
  const session = loadSession();
  if (!session) return showEntry();

  initEndingScreen({
    session,
    onBackToTracks: showTrackSelect,
    onExit() {
      clearSession();
      showEntry();
    },
  });
}

/**
 * 트랙 선택 = 게임의 허브.
 * 안 푼 트랙 플레이 / 완료한 트랙 리포트 다시 보기 / 게임 마치기 중에서 고른다.
 */
function showTrackSelect() {
  const session = loadSession();
  if (!session) return showEntry();

  // 허브로 돌아왔으니 "선택한 트랙"을 비운다.
  // 맵에는 트랙을 벗어나는 버튼이 없으므로, 이걸 비워두지 않으면
  // 허브에서 새로고침했을 때 이전 트랙 맵으로 튕겨 돌아간다.
  // (플레이 중 새로고침은 track이 남아 있어 그대로 맵으로 이어진다)
  updateSession({ track: null });

  initTrackSelectScreen({
    session,
    onSelectTrack(track) {
      updateSession({ track });
      showMap();
    },
    // 완료한 트랙의 저장된 리포트 다시 보기 (세션의 현재 트랙과 무관하게 해당 트랙 기준)
    onShowReport(track) {
      showReport({ ...session, track: normalizeTrack(track) });
    },
    onFinishGame: showOutro,
    onExit() {
      clearSession();
      showEntry();
    },
  });
}

function showMap() {
  const session = loadSession();
  if (!session) return showEntry();
  // 트랙이 없으면(첫 입장·이전 버전 세션) 트랙 선택부터
  if (!isTrack(session.track)) return showTrackSelect();

  initStageMapScreen({
    session,
    onSelectStage: (stage, ctx) => showPlay(session, stage, ctx),
    onShowReport: () => showReport(session),
    onExit() {
      clearSession();
      showEntry();
    },
  });
}

/**
 * 설득 리포트 — 트랙의 마지막 스테이지를 마치면 자동으로 여기로 온다.
 * 리포트를 닫으면 스테이지 맵이 아니라 트랙 선택(허브)으로 돌아간다.
 */
function showReport(session) {
  initReportScreen({ session, onBack: showTrackSelect });
}

/**
 * 스테이지 선택 → 상황 브리핑 먼저. [START]를 눌러야 대화가 시작된다.
 * (브리핑 단계에서는 채점·게이지·타이머가 전혀 돌지 않는다)
 * @param {object} ctx - 맵에서 넘겨준 저장용 컨텍스트 { orderMap, totalStages, activeRounds }
 */
function showPlay(session, stage, ctx) {
  initBriefingScreen({
    stage,
    track: session.track,
    onStart: () => startConversation(session, stage, ctx),
    onBack: showMap,
  });
}

/** 실제 대화 시작 — 브리핑의 [START]에서만 호출된다 */
function startConversation(session, stage, ctx) {
  // 이번 스테이지로 트랙을 다 마쳤는지 — 결과 화면의 버튼 문구·다음 화면을 정한다
  let trackFinished = false;

  initPlayScreen({
    roomCode: session.roomCode,
    track: session.track,
    stageId: stage.id,
    totalStages: ctx.totalStages, // 우상단 EP 노드 개수(표시용)
    // 종료 시: 최종 게이지를 최신 점수로, 대화 로그(turns)와 함께 저장
    // 결과는 선택한 트랙의 stageResults_{track}에 들어간다 (트랙 간 간섭 없음)
    async onEnd(finalScore, turns) {
      const saved = await saveStageResult(
        session.roomCode,
        session.playerId,
        session.track,
        stage.id,
        { stageScore: finalScore, turnCount: turns.length, turns },
        ctx
      );
      // saveStageResult가 이미 계산해 둔 트랙 상태를 그대로 쓴다 (채점 로직은 건드리지 않는다)
      trackFinished = saved?.status === 'finished';
      return trackFinished ? { exitLabel: '📊 설득 리포트 보기' } : null;
    },
    // 트랙의 마지막 스테이지였다면 별도 버튼 없이 곧바로 그 트랙의 리포트로 넘어간다
    onExit: () => (trackFinished ? showReport(session) : showMap()),
  });
}

// 부팅: 세션 + 트랙이 있으면 맵으로, 세션만 있으면 오프닝(이미 봤으면 트랙 선택), 없으면 입장 화면
const booted = loadSession();
if (!booted) showEntry();
else if (isTrack(booted.track)) showMap();
else showOpening();
