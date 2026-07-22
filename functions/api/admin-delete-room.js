/**
 * POST /api/admin-delete-room — 입장 코드(방) 삭제 (Cloudflare Pages Function)
 *
 * 요청:  { "id": "관리자 아이디", "password": "관리자 비밀번호", "roomCode": "AB3K" }
 * 응답:  200 { success: true, deleted: { players, results, stages } }
 *        401/400/404/500 { success: false, error }
 *
 * ⚠️ 관리자 인증(ADMIN_ID + ADMIN_PASSWORD)을 통과한 요청만 처리한다. 되돌릴 수 없다.
 *
 * Firestore는 문서를 지워도 하위 컬렉션이 함께 지워지지 않으므로
 * (지운 문서 아래에 "고아 문서"가 남는다) scripts/delete-rooms.js와 같은 순서로 재귀 삭제한다:
 *
 *   rooms/{코드}
 *     players/*  →  players/{id}/stageResults_work/*, stageResults_life/*, (옛) stageResults/*
 *     stages_work/*, stages_life/*, (옛) stages/*
 *   → 마지막에 rooms/{코드} 문서 자체
 */

import { jsonResponse, getAccessToken, getDocument, listCollection, deleteDocument } from '../_lib/gcp.js';
import { verifyAdminCredentials } from '../_lib/adminAuth.js';

// 트랙별 서브컬렉션 이름 규칙 (src/common/tracks.js와 일치)
const TRACK_KEYS = ['work', 'life'];
// 옛 구조(트랙 도입 이전) 방의 컬렉션도 함께 정리한다
const RESULT_COLLECTIONS = [...TRACK_KEYS.map((t) => `stageResults_${t}`), 'stageResults'];
const STAGE_COLLECTIONS = [...TRACK_KEYS.map((t) => `stages_${t}`), 'stages'];

/** 컬렉션의 문서를 모두 지우고 삭제한 개수를 돌려준다. */
async function deleteCollection(env, token, collectionPath) {
  const docs = await listCollection(env, token, collectionPath);
  // 문서 수가 워크숍 규모(수십~수백)라 순차 삭제로 충분하다 — 동시 요청으로 쿼터를 때리지 않는다
  for (const d of docs) {
    await deleteDocument(env, token, `${collectionPath}/${d.id}`);
  }
  return docs.length;
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: '요청 본문이 올바른 JSON이 아닙니다.' }, 400);
  }

  const auth = await verifyAdminCredentials(env, body.id, body.password);
  if (!auth.ok) {
    return jsonResponse({ success: false, error: auth.error }, auth.status);
  }

  const roomCode = typeof body.roomCode === 'string' ? body.roomCode.trim().toUpperCase() : '';
  // 방 코드는 문서 ID로 경로에 그대로 들어간다 — 경로 조작을 막기 위해 영숫자만 허용
  if (!/^[A-Z0-9]{2,16}$/.test(roomCode)) {
    return jsonResponse({ success: false, error: '방 코드가 올바르지 않습니다.' }, 400);
  }

  try {
    const token = await getAccessToken(env);
    const roomPath = `rooms/${roomCode}`;

    const room = await getDocument(env, token, roomPath);
    if (!room) {
      return jsonResponse({ success: false, error: `방 ${roomCode}을(를) 찾을 수 없습니다.` }, 404);
    }

    // 1) 참가자 — 각자의 스테이지 결과부터 지우고 참가자 문서를 지운다
    const players = await listCollection(env, token, `${roomPath}/players`);
    let resultCount = 0;
    for (const player of players) {
      const playerPath = `${roomPath}/players/${player.id}`;
      for (const name of RESULT_COLLECTIONS) {
        resultCount += await deleteCollection(env, token, `${playerPath}/${name}`);
      }
      await deleteDocument(env, token, playerPath);
    }

    // 2) 트랙별 스테이지
    let stageCount = 0;
    for (const name of STAGE_COLLECTIONS) {
      stageCount += await deleteCollection(env, token, `${roomPath}/${name}`);
    }

    // 3) 방 문서 자체
    await deleteDocument(env, token, roomPath);

    console.log(
      `[admin-delete-room] rooms/${roomCode} 삭제 완료 (참가자 ${players.length}명, 결과 ${resultCount}건, 스테이지 ${stageCount}개)`
    );
    return jsonResponse({
      success: true,
      deleted: { players: players.length, results: resultCount, stages: stageCount },
    });
  } catch (err) {
    console.error(`[admin-delete-room] 삭제 실패 rooms/${roomCode}:`, err?.message || err);
    return jsonResponse({ success: false, error: '방 삭제 중 오류가 발생했습니다.' }, 500);
  }
}

// POST 외 메서드는 405
export async function onRequest() {
  return jsonResponse({ success: false, error: 'POST 메서드만 지원합니다.' }, 405);
}
