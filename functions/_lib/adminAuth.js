/**
 * adminAuth.js — 관리자 아이디·비밀번호 검증 (Functions 공용)
 *
 * 로그인(/api/admin-auth)과 관리자 전용 API(/api/admin-delete-room 등)가 같은 규칙으로
 * 자격증명을 확인하도록 한 곳에 모아 둔다. 관리자 인증이 필요한 새 엔드포인트를 만들면
 * 반드시 verifyAdminCredentials()를 쓸 것 — 검증 규칙이 갈라지지 않게.
 *
 * `_lib` 폴더는 언더스코어 prefix라 라우팅되지 않는다 (Pages Functions 규칙).
 */

/**
 * 자격증명이 설정돼 있지 않을 때 **개발 환경에서만** 쓰는 기본값.
 *
 * ⚠️ 이 값은 저장소에 그대로 적혀 있어 공개된 것과 같다.
 *    그래서 프로덕션에서는 폴백을 아예 막고 500으로 응답한다 (아래 verifyAdminCredentials 참고).
 */
const DEFAULT_ADMIN_ID = 'learn2';
const DEFAULT_ADMIN_PASSWORD = '0067';

/**
 * 개발 환경인가 — `ENVIRONMENT`가 **명시적으로 "development"일 때만** 참이다.
 *
 * 값이 없으면 프로덕션으로 본다(fail closed). 반대로 "production일 때만 막는" 방식이면
 * 배포하며 변수 설정을 깜빡한 순간 공개된 기본 자격증명으로 관리자 페이지가 열린다 —
 * 막으려던 바로 그 상황이라 기본값을 안전한 쪽에 둔다.
 *
 * 참고: 이 플래그는 **자격증명이 없을 때만** 의미가 있다. ADMIN_ID·ADMIN_PASSWORD가
 * 제대로 설정돼 있으면 ENVIRONMENT가 무엇이든(없어도) 정상 동작한다.
 */
const isDevelopment = (env) => env.ENVIRONMENT === 'development';

/**
 * 타이밍 공격을 피하기 위해 두 문자열의 SHA-256 해시를 비교한다.
 * (길이 차이·문자 위치에 따른 비교 시간 편차 제거)
 */
export async function safeEqual(a, b) {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < viewA.length; i++) diff |= viewA[i] ^ viewB[i];
  return diff === 0;
}

/**
 * 요청에 담긴 아이디·비밀번호가 모두 맞는지 확인한다.
 *
 * 아이디와 비밀번호 중 무엇이 틀렸는지는 **구분해서 알려주지 않는다** — 어느 쪽이
 * 맞았는지 흘리면 공격자가 아이디를 먼저 확정할 수 있다. 같은 이유로 둘 중 하나가
 * 틀려도 나머지 비교를 건너뛰지 않는다(단축 평가 없음).
 *
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function verifyAdminCredentials(env, id, password) {
  // 자격증명이 하나라도 비어 있으면 "설정되지 않음"으로 본다
  const configured = Boolean(env.ADMIN_ID && env.ADMIN_PASSWORD);

  if (!configured) {
    // 프로덕션: 공개된 기본값으로 관리자 페이지가 열리는 일이 없도록 아예 막는다.
    // (자격증명 값은 어느 쪽 경로에서도 로그에 남기지 않는다)
    if (!isDevelopment(env)) {
      console.error(
        '[adminAuth] ADMIN_ID/ADMIN_PASSWORD가 설정되지 않았습니다. ' +
          '프로덕션에서는 기본값 폴백을 허용하지 않습니다 — Cloudflare Secret으로 두 값을 등록하세요. ' +
          '(로컬 개발이라면 ENVIRONMENT=development 를 설정하세요)'
      );
      return { ok: false, status: 500, error: '관리자 자격증명이 서버에 설정되지 않았습니다.' };
    }
    // 개발: 기본값으로 폴백하되 경고를 남긴다
    console.warn(
      '[adminAuth] ⚠️ ADMIN_ID/ADMIN_PASSWORD 환경변수가 없어 저장소에 적힌 개발용 기본값을 씁니다. ' +
        '배포 환경이라면 지금 Cloudflare Secret을 설정하세요.'
    );
  }

  const expectedId = env.ADMIN_ID || DEFAULT_ADMIN_ID;
  const expectedPassword = env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

  const invalid = { ok: false, status: 401, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  if (typeof id !== 'string' || typeof password !== 'string' || !id || !password) {
    return { ok: false, status: 400, error: '아이디와 비밀번호를 모두 입력해 주세요.' };
  }

  // 둘 다 비교한 뒤에 판정한다 (어느 쪽에서 걸렸는지 응답 시간으로도 드러나지 않게)
  const [idOk, passwordOk] = await Promise.all([
    safeEqual(id, expectedId),
    safeEqual(password, expectedPassword),
  ]);
  return idOk && passwordOk ? { ok: true } : invalid;
}
