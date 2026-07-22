/**
 * session.js — 입장 정보(코드/이름/소속/playerId)를 sessionStorage에 보관해
 * 새로고침해도 이어하기가 되도록 한다. (탭을 닫으면 사라짐 — 의도된 동작)
 */

const KEY = 'persuade.session';

/**
 * { roomCode, name, affiliation, playerId, track } 또는 null
 * track은 트랙 선택 화면에서 고른 뒤에 채워진다 (없으면 트랙 선택 화면부터 시작).
 */
export function loadSession() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.roomCode && s.playerId ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

/** 세션 일부만 갱신한다 (예: 트랙 변경). 갱신된 세션을 반환. */
export function updateSession(patch) {
  const next = { ...(loadSession() || {}), ...patch };
  saveSession(next);
  return next;
}

export function clearSession() {
  sessionStorage.removeItem(KEY);
}
