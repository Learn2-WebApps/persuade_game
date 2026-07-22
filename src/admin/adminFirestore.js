/**
 * adminFirestore.js — 관리자 대시보드용 Firestore 헬퍼
 *
 * ⚠️ 보안: 현재는 Firestore 규칙이 열려 있는 개발 단계라 클라이언트에서 직접 쓴다.
 *    배포 전에는 규칙 강화(templates 읽기·rooms 쓰기를 관리자만 허용) 또는
 *    서버 함수(/api/admin-*) 경유로 옮겨야 한다. → README "배포 전 점검" 참고
 */

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  getCountFromServer,
} from 'firebase/firestore';
import { getDb } from '../common/firebase.js';
import { TRACKS, TRACK_KEYS, trackLabel, stagesCollection, resultsCollection } from '../common/tracks.js';

export { TRACKS, TRACK_KEYS, trackLabel };

// ─────────────────────────────────────────────────────────────
// 마스터 템플릿 (트랙별)
// ─────────────────────────────────────────────────────────────

/** templates/{track} 문서 + stages를 읽는다. 없으면 null. */
export async function fetchMaster(track) {
  const db = getDb();
  const masterSnap = await getDoc(doc(db, 'templates', track));
  if (!masterSnap.exists()) return null;
  const stagesSnap = await getDocs(query(collection(db, 'templates', track, 'stages'), orderBy('order')));
  return {
    ...masterSnap.data(),
    stages: stagesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// ─────────────────────────────────────────────────────────────
// 방 관리
// ─────────────────────────────────────────────────────────────

/** 모든 방 목록 (createdAt 내림차순, 필드 없는 문서는 뒤로) */
export async function listRooms() {
  const db = getDb();
  const snap = await getDocs(collection(db, 'rooms'));
  const rooms = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
  rooms.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return rooms;
}

/** 방의 참가자 수 (집계 쿼리 — 문서를 내려받지 않아 저렴) */
export async function countPlayers(roomCode) {
  const db = getDb();
  const agg = await getCountFromServer(collection(db, 'rooms', roomCode, 'players'));
  return agg.data().count;
}

// 헷갈리는 문자(0/O, 1/I/L) 제외한 4자리 코드용 문자 집합
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

/** 중복되지 않는 4자리 방 코드를 생성한다. */
export async function generateRoomCode() {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const snap = await getDoc(doc(db, 'rooms', code));
    if (!snap.exists()) return code;
  }
  throw new Error('방 코드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
}

/**
 * 두 트랙(업무·일상) 마스터를 모두 복사해 새 방을 만든다.
 * 방 하나에 두 트랙이 다 들어가고, 학습자가 입장 후 트랙을 고른다.
 *
 *   rooms/{code}/stages_work/stage1~5
 *   rooms/{code}/stages_life/stage1~5
 *
 * settings는 두 트랙 공통으로 하나만 둔다(마스터의 값이 서로 같음 — 업무 트랙 것을 기준).
 * @returns {Promise<string>} 생성된 방 코드
 */
export async function createRoomFromMaster(roomName) {
  const db = getDb();

  const masters = {};
  for (const track of TRACK_KEYS) {
    const master = await fetchMaster(track);
    if (!master) {
      throw new Error(
        `${trackLabel(track)} 마스터 템플릿(templates/${track})이 없습니다. npm run seed:master 를 먼저 실행하세요.`
      );
    }
    if (!master.stages.length) {
      throw new Error(`${trackLabel(track)} 마스터 템플릿에 스테이지가 없습니다.`);
    }
    masters[track] = master;
  }

  const code = await generateRoomCode();
  const batch = writeBatch(db);

  batch.set(doc(db, 'rooms', code), {
    roomName: roomName.trim(),
    tracks: [...TRACK_KEYS], // 이 방에 들어 있는 트랙
    createdBy: 'admin',
    createdAt: serverTimestamp(),
    status: 'open',
    settings: { ...masters[TRACK_KEYS[0]].settings },
  });

  for (const track of TRACK_KEYS) {
    for (const stage of masters[track].stages) {
      const { id, ...data } = stage;
      batch.set(doc(db, 'rooms', code, stagesCollection(track), id), data);
    }
  }

  await batch.commit();
  return code;
}

/** 방 열기/닫기 */
export async function setRoomStatus(roomCode, status) {
  await updateDoc(doc(getDb(), 'rooms', roomCode), { status });
}

/**
 * 방 settings 부분 갱신 — 저장 즉시 학습자 쪽 onSnapshot으로 반영된다.
 * (시간 정책: 이미 진행 중인 스테이지는 방해하지 않음 — 학습자 쪽이
 *  스테이지 "진입 시점"의 값을 쓰므로 다음 진입부터 자연히 적용된다)
 */
export async function updateRoomSettings(roomCode, partialSettings) {
  const db = getDb();
  const updates = {};
  for (const [k, v] of Object.entries(partialSettings)) {
    updates[`settings.${k}`] = v;
  }
  await updateDoc(doc(db, 'rooms', roomCode), updates);
}

// ─────────────────────────────────────────────────────────────
// 참가자 모니터링
// ─────────────────────────────────────────────────────────────

/**
 * 방의 players 컬렉션을 실시간 구독한다. 반환값은 구독 해제 함수.
 * callback([{ id, ...data }]) — 총점 내림차순 정렬.
 */
export function subscribePlayers(roomCode, callback) {
  const db = getDb();
  return onSnapshot(
    collection(db, 'rooms', roomCode, 'players'),
    (snap) => {
      const players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      players.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
      callback(players);
    },
    (err) => {
      console.error('[admin] 참가자 구독 오류:', err);
      callback(null);
    }
  );
}

/**
 * 플레이어 한 명의 스테이지 결과를 트랙별로 읽는다.
 * 반환: { work: { [stageId]: {...} }, life: { ... } }
 */
export async function fetchPlayerResults(roomCode, playerId) {
  const db = getDb();
  const out = {};
  await Promise.all(
    TRACK_KEYS.map(async (track) => {
      const snap = await getDocs(
        collection(db, 'rooms', roomCode, 'players', playerId, resultsCollection(track))
      );
      const byStage = {};
      snap.forEach((d) => {
        byStage[d.id] = d.data();
      });
      out[track] = byStage;
    })
  );
  return out;
}

// ─────────────────────────────────────────────────────────────
// CSV 내보내기
// ─────────────────────────────────────────────────────────────

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const fmtTimestamp = (ts) =>
  ts?.toDate ? ts.toDate().toLocaleString('ko-KR', { hour12: false }) : '';

/**
 * 참가자 데이터를 CSV 문자열로 만든다. 두 트랙의 스테이지가 모두 컬럼으로 들어간다.
 * @param {Array} players - subscribePlayers가 준 배열
 * @param {object} resultsByPlayer - { [playerId]: { work: {[stageId]: {stageScore}}, life: {...} } }
 * @param {object} stagesByTrack - { work: [{id, order, title}], life: [...] } (각 order 정렬)
 */
export function buildPlayersCsv(players, resultsByPlayer, stagesByTrack) {
  const columns = TRACK_KEYS.flatMap((track) =>
    (stagesByTrack[track] || []).map((s) => ({ track, stage: s }))
  );

  const header = [
    '이름',
    '소속',
    '입장시간',
    ...columns.map((c) => `[${trackLabel(c.track, { short: true })}] EP${c.stage.order} ${c.stage.title}`),
    ...TRACK_KEYS.map((t) => `${trackLabel(t, { short: true })} 합계`),
    '총점',
    '상태',
  ];

  const rows = players.map((p) => [
    p.name,
    p.affiliation,
    fmtTimestamp(p.enteredAt),
    ...columns.map((c) => resultsByPlayer[p.id]?.[c.track]?.[c.stage.id]?.stageScore ?? ''),
    ...TRACK_KEYS.map((t) => p.progress?.[t]?.totalScore ?? 0),
    p.totalScore ?? 0,
    p.status === 'finished' ? '완료' : '진행 중',
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** CSV 문자열을 파일로 다운로드 (엑셀 한글 호환을 위해 UTF-8 BOM 추가) */
export function downloadCsv(csvText, filename) {
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([BOM + csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
