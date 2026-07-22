/**
 * adminApi.js — 관리자 인증 상태 + 관리자 전용 서버 API 호출
 *
 * 방 삭제처럼 되돌릴 수 없는 작업은 클라이언트에서 직접 Firestore를 건드리지 않고
 * 서버 함수(/api/admin-*)를 거친다. 서버가 ADMIN_PASSWORD로 요청을 검증한다.
 *
 * ⚠️ 그래서 로그인할 때 입력한 아이디·비밀번호를 sessionStorage에 함께 보관한다
 *    (탭을 닫으면 사라짐 — 우리 API로만, HTTPS로만 전송된다).
 *    토큰 발급 방식으로 바꾸려면 /api/admin-auth가 서명된 단기 토큰을 내려주고
 *    여기서는 그 토큰만 저장하도록 고치면 된다. → README "배포 전 점검" 참고
 */

const AUTH_KEY = 'persuade.adminAuthed';
const ID_KEY = 'persuade.adminId';
const PASS_KEY = 'persuade.adminPass';

/** 로그인 성공 시 호출 — 인증 상태와 자격증명(아이디+비밀번호)을 세션에 보관한다. */
export function setAdminAuthed(id, password) {
  sessionStorage.setItem(AUTH_KEY, '1');
  sessionStorage.setItem(ID_KEY, id);
  sessionStorage.setItem(PASS_KEY, password);
}

export function isAdminAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === '1';
}

export function clearAdminAuth() {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(ID_KEY);
  sessionStorage.removeItem(PASS_KEY);
}

/** 보관해 둔 관리자 자격증명 (없으면 빈 문자열 — 서버가 401로 되돌려준다) */
const adminCredentials = () => ({
  id: sessionStorage.getItem(ID_KEY) || '',
  password: sessionStorage.getItem(PASS_KEY) || '',
});

/**
 * 방(입장 코드)을 하위 데이터까지 통째로 삭제한다. 되돌릴 수 없다.
 * @returns {Promise<{ players: number, results: number, stages: number }>} 삭제된 문서 수
 */
export async function deleteRoomViaApi(roomCode) {
  const res = await fetch('/api/admin-delete-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...adminCredentials(), roomCode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `방 삭제에 실패했어요 (${res.status})`);
  }
  return data.deleted || {};
}
