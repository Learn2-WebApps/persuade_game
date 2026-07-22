/**
 * firebase.js — Firebase 웹 SDK 초기화 + Firestore 읽기/쓰기 헬퍼
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { TRACK_KEYS, stagesCollection, resultsCollection } from './tracks.js';

// ─────────────────────────────────────────────────────────────
// Firebase 웹 앱 config
// (웹 config의 apiKey는 서버 비밀키가 아니라 공개 식별자 — 프론트에 넣어도 됨)
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyAHNfRk5TrhGcKMpOq-lQVNoIJj2a8p0nw',
  authDomain: 'persuade-game.firebaseapp.com',
  projectId: 'persuade-game',
  storageBucket: 'persuade-game.firebasestorage.app',
  messagingSenderId: '271278221778',
  appId: '1:271278221778:web:d43ad3aabdda858852c00b',
};

/** config가 아직 placeholder면 false — 화면에서 내장 데모 데이터로 폴백한다 */
export const isFirebaseConfigured = !firebaseConfig.apiKey.startsWith('YOUR_');

let db = null;
if (isFirebaseConfigured) {
  db = getFirestore(initializeApp(firebaseConfig));
}

/** Firestore 인스턴스 (관리자 화면 등에서 직접 쿼리할 때 사용) */
export function getDb() {
  return db;
}

// ─────────────────────────────────────────────────────────────
// 룸 / 스테이지 읽기
// ─────────────────────────────────────────────────────────────

/** rooms/{roomCode} 문서를 읽는다. 없으면 null. */
export async function fetchRoom(roomCode) {
  const snap = await getDoc(doc(db, 'rooms', roomCode));
  return snap.exists() ? snap.data() : null;
}

/**
 * rooms/{roomCode}/stages_{track}/{stageId} 문서를 읽는다. 없으면 null.
 *
 * ⚠️ 스테이지 문서에는 hiddenNeed·scoringExamples 같은 "정답" 필드도 들어 있어
 *    클라이언트에서 읽으면 개발자 도구로 볼 수 있다. 지금은 프로토타입이라 허용하지만,
 *    나중에 공개 필드만 내려주는 서버 엔드포인트(예: /api/stage)로 옮기는 것을 권장.
 */
export async function fetchStage(roomCode, track, stageId) {
  const snap = await getDoc(doc(db, 'rooms', roomCode, stagesCollection(track), stageId));
  return snap.exists() ? snap.data() : null;
}

/** 트랙의 스테이지 전체를 order 오름차순으로 읽는다. [{ id, ...data }] */
export async function fetchStages(roomCode, track) {
  const q = query(collection(db, 'rooms', roomCode, stagesCollection(track)), orderBy('order'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * rooms/{roomCode} 문서를 실시간 구독한다 (settings.activeRounds 변경 즉시 반영용).
 * 반환값은 구독 해제 함수 — 화면을 떠날 때 반드시 호출할 것.
 */
export function subscribeRoom(roomCode, callback) {
  return onSnapshot(
    doc(db, 'rooms', roomCode),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err) => {
      console.error('[firebase] 룸 구독 오류:', err);
      callback(null);
    }
  );
}

// ─────────────────────────────────────────────────────────────
// 플레이어 (진행 저장 / 이어하기)
// rooms/{roomCode}/players/{playerId}
//   name, affiliation, enteredAt, lastActiveAt, status
//   totalScore              — 두 트랙 합계 (관리자 표 정렬용)
//   progress: {             — 트랙별로 완전히 독립
//     work: { totalScore, currentMaxStageOrder, status },
//     life: { ... }
//   }
//   finalReports: { work: {...}, life: {...} }
//   └ stageResults_work/{stageId}, stageResults_life/{stageId}
// ─────────────────────────────────────────────────────────────

/** 트랙 하나의 빈 진행상황 */
const emptyProgress = () => ({ totalScore: 0, currentMaxStageOrder: 1, status: 'active' });

/** 두 트랙 모두 채워진 progress 객체를 만든다 (필드가 없는 옛 문서도 안전하게 읽히도록) */
export function readProgress(player, track) {
  return { ...emptyProgress(), ...(player?.progress?.[track] || {}) };
}

/**
 * 이름+소속으로 안정적인 playerId를 만든다 (재입장 시 같은 문서를 찾기 위함).
 * 공백은 '-'로, Firestore 문서 ID에 문제되는 문자는 제거한다.
 */
export function makePlayerId(name, affiliation) {
  const norm = (s) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[/#$[\].]/g, '');
  return `${norm(affiliation)}__${norm(name)}`;
}

/**
 * 플레이어 문서를 찾아 반환하고, 없으면 새로 만든다.
 * 반환: { playerId, player, isNew }
 */
export async function getOrCreatePlayer(roomCode, name, affiliation) {
  const playerId = makePlayerId(name, affiliation);
  const ref = doc(db, 'rooms', roomCode, 'players', playerId);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    // 이어하기: 접속 시각만 갱신
    await setDoc(ref, { lastActiveAt: serverTimestamp() }, { merge: true });
    return { playerId, player: snap.data(), isNew: false };
  }

  const player = {
    name: name.trim(),
    affiliation: affiliation.trim(),
    enteredAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    totalScore: 0, // 두 트랙 합계
    status: 'active',
    // 트랙별 진행상황 — 한쪽 트랙 진행이 다른 쪽 잠금해제에 영향을 주지 않는다
    progress: Object.fromEntries(TRACK_KEYS.map((t) => [t, emptyProgress()])),
  };
  await setDoc(ref, player);
  return { playerId, player, isNew: true };
}

/** 플레이어 문서를 읽는다. 없으면 null. */
export async function fetchPlayer(roomCode, playerId) {
  const snap = await getDoc(doc(db, 'rooms', roomCode, 'players', playerId));
  return snap.exists() ? snap.data() : null;
}

/**
 * 생성된 최종 리포트를 트랙별로 저장한다 (재조회 시 API 재호출 없이 표시 → 비용 절감).
 * finalReports.{track} 에 들어가므로 두 트랙 리포트가 서로 덮어쓰지 않는다.
 */
export async function savePlayerReport(roomCode, playerId, track, report) {
  await setDoc(
    doc(db, 'rooms', roomCode, 'players', playerId),
    {
      finalReports: { [track]: report },
      finalReportAt: { [track]: serverTimestamp() },
    },
    { merge: true }
  );
}

/** 트랙의 스테이지 결과 전체를 읽는다. { [stageId]: { stageScore, ... } } */
export async function fetchStageResults(roomCode, playerId, track) {
  const snap = await getDocs(
    collection(db, 'rooms', roomCode, 'players', playerId, resultsCollection(track))
  );
  const out = {};
  snap.forEach((d) => {
    out[d.id] = d.data();
  });
  return out;
}

/**
 * 스테이지 결과를 저장하고 플레이어 집계 필드를 갱신한다.
 *
 * [정책 — 나중에 바꾸려면 여기 수정]
 * - 재플레이 점수: "최신 점수로 덮어쓰기" (최고점 유지로 바꾸려면 기존 값과 Math.max 비교)
 * - totalScore: 각 stageResults의 "합계" (평균으로 바꾸려면 아래 reduce 부분 수정)
 *
 * @param {object} ctx - { orderMap: {stageId: order}, totalStages, activeRounds }
 */
export async function saveStageResult(roomCode, playerId, track, stageId, { stageScore, turnCount, turns }, ctx) {
  // Firestore는 undefined 값을 거부한다(저장 전체가 실패) — 턴 로그를 안전한 형태로 정규화
  const safeTurns = (turns ?? []).map((t) => ({
    userMessage: t.userMessage ?? '',
    scoreDelta: Number(t.scoreDelta) || 0,
    gaugeAfter: Number(t.gaugeAfter) || 0,
    actionTags: Array.isArray(t.actionTags) ? t.actionTags.filter((x) => typeof x === 'string') : [],
    characterReply: t.characterReply ?? '',
    timestamp: Number(t.timestamp) || Date.now(),
  }));

  const resultRef = doc(
    db,
    'rooms',
    roomCode,
    'players',
    playerId,
    resultsCollection(track),
    stageId
  );
  // setDoc(merge 없음) = 문서 전체 교체 → 재플레이 시 turns도 최신 플레이 기준으로 덮어쓰기
  await setDoc(resultRef, {
    stageScore,
    turnCount: turnCount ?? safeTurns.length,
    // 최종 리포트가 실제 발화를 인용할 수 있도록 턴별 대화 로그를 저장한다
    turns: safeTurns,
    completedAt: serverTimestamp(),
  });

  // 저장 후 이 트랙의 결과를 다시 읽어 집계 필드를 재계산 (단순·안전 우선)
  const results = await fetchStageResults(roomCode, playerId, track);
  const trackScore = Object.values(results).reduce((sum, r) => sum + (r.stageScore || 0), 0);
  const maxCompletedOrder = Math.max(0, ...Object.keys(results).map((id) => ctx.orderMap[id] || 0));
  const currentMaxStageOrder = Math.min(maxCompletedOrder + 1, ctx.totalStages);

  // 관리자가 연 라운드(activeRounds)까지 모두 완료했으면 finished
  const openCount = Math.min(ctx.activeRounds ?? ctx.totalStages, ctx.totalStages);
  const completedOpenCount = Object.keys(results).filter((id) => (ctx.orderMap[id] || 0) <= openCount).length;
  const trackStatus = completedOpenCount >= openCount ? 'finished' : 'active';

  // 다른 트랙 점수는 건드리지 않고, 합계(totalScore)만 다시 계산한다
  const playerRef = doc(db, 'rooms', roomCode, 'players', playerId);
  const playerSnap = await getDoc(playerRef);
  const progress = { ...(playerSnap.data()?.progress || {}) };
  progress[track] = { totalScore: trackScore, currentMaxStageOrder, status: trackStatus };

  const totalScore = TRACK_KEYS.reduce((sum, t) => sum + (progress[t]?.totalScore || 0), 0);
  // 전체 status는 "두 트랙 다 끝냈는가" 기준
  const status = TRACK_KEYS.every((t) => progress[t]?.status === 'finished') ? 'finished' : 'active';

  await setDoc(
    playerRef,
    { progress, totalScore, status, lastActiveAt: serverTimestamp() },
    { merge: true }
  );

  return { trackScore, totalScore, currentMaxStageOrder, status: trackStatus };
}
