/**
 * POST /api/admin-auth — 관리자 아이디·비밀번호 검증 (Cloudflare Pages Function)
 *
 * 요청:  { "id": "...", "password": "..." }
 * 응답:  200 { "success": true }  /  401 { "success": false, "error": "..." }
 *
 * 필요한 환경변수 (없으면 개발용 기본값 learn2 / 0067 — _lib/adminAuth.js 참고):
 *   ADMIN_ID       - 관리자 아이디
 *   ADMIN_PASSWORD - 관리자 비밀번호 (절대 프론트엔드 코드에 두지 말 것)
 */

import { verifyAdminCredentials } from '../_lib/adminAuth.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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
  return jsonResponse({ success: true });
}

// POST 외 메서드는 405
export async function onRequest() {
  return jsonResponse({ success: false, error: 'POST 메서드만 지원합니다.' }, 405);
}
