/**
 * gcp.js — Cloudflare Functions 공용 헬퍼
 * (Firestore REST 접근 + 서비스 계정 JWT 인증 + Gemini 호출 + 응답 유틸)
 *
 * `_lib` 폴더는 언더스코어 prefix라 라우팅되지 않는다 (Pages Functions 규칙).
 */

// ─────────────────────────────────────────────────────────────
// 응답 유틸
// ─────────────────────────────────────────────────────────────

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(message, status) {
  return jsonResponse({ error: message }, status);
}

// ─────────────────────────────────────────────────────────────
// 서비스 계정 JWT → OAuth 액세스 토큰
// ─────────────────────────────────────────────────────────────

// 같은 isolate에서 재사용되는 토큰 캐시 (만료 1분 전까지 재사용)
let tokenCache = { token: null, exp: 0 };

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/\\n/g, '\n') // .dev.vars/대시보드에 "\n" 문자열로 저장된 경우 복원
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;

  const encoder = new TextEncoder();
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        iss: env.FIREBASE_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth 토큰 발급 실패 (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

// ─────────────────────────────────────────────────────────────
// Firestore REST
// ─────────────────────────────────────────────────────────────

/** Firestore REST의 typed value를 일반 JS 값으로 변환 */
export function decodeFirestoreValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in v) return decodeFirestoreFields(v.mapValue.fields || {});
  return null;
}

export function decodeFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeFirestoreValue(v);
  return out;
}

const firestoreBase = (env) =>
  `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/** Firestore 문서 하나를 읽는다. 없으면 null. */
export async function getDocument(env, token, docPath) {
  const res = await fetch(`${firestoreBase(env)}/${docPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Firestore 조회 실패 (${res.status}): ${await res.text()}`);
  }
  const doc = await res.json();
  return decodeFirestoreFields(doc.fields || {});
}

/** 컬렉션의 모든 문서를 [{ id, ...fields }]로 읽는다 (pageSize 300, 워크숍 규모 가정). */
export async function listCollection(env, token, collectionPath) {
  const res = await fetch(`${firestoreBase(env)}/${collectionPath}?pageSize=300`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Firestore 목록 조회 실패 (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.documents || []).map((d) => ({
    id: d.name.split('/').pop(),
    ...decodeFirestoreFields(d.fields || {}),
  }));
}

/**
 * Firestore 문서 하나를 지운다. 이미 없는 문서를 지워도 오류가 아니다(멱등).
 *
 * ⚠️ Firestore는 문서를 지워도 하위 컬렉션이 함께 지워지지 않는다.
 *    (지운 문서 아래에 "고아 문서"가 남는다) — 하위 컬렉션은 호출부에서 직접 순회할 것.
 */
export async function deleteDocument(env, token, docPath) {
  const res = await fetch(`${firestoreBase(env)}/${docPath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Firestore 삭제 실패 (${res.status}): ${await res.text()}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────────────────────

/**
 * Gemini generateContent 호출 후 응답 텍스트를 반환한다.
 * @param {object} generationConfig - temperature, responseSchema 등
 */
/**
 * 키가 제대로 주입됐는지 확인하기 위한 요약 문자열.
 * ⚠️ 앞 4자리와 길이만 남긴다 — 키 전체는 절대 로그에 찍지 말 것.
 * (URL에도 키가 들어가므로 URL 자체를 로그에 남기면 안 된다)
 */
function describeApiKey(key) {
  if (typeof key !== 'string' || key === '') return '(없음 — 환경변수 미설정)';
  return `${key.slice(0, 4)}…  길이 ${key.length}`;
}

export async function callGemini(env, model, prompt, generationConfig) {
  const apiKey = env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  // (1) 키 확인 + 호출 시작 로그
  console.log(`[gemini] 호출 시작 model=${model} key=${describeApiKey(apiKey)} prompt=${prompt.length}자`);

  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          ...generationConfig,
        },
      }),
    });
  } catch (err) {
    // 네트워크 단계 실패 (응답 자체가 없음)
    const elapsedMs = Date.now() - startedAt;
    console.error(`[gemini] 네트워크 오류 (${elapsedMs}ms) model=${model}: ${err?.message || err}`);
    throw err;
  }

  const elapsedMs = Date.now() - startedAt;

  // (2)(3) 상태 코드 + 에러 본문 원문 + 소요 시간
  if (!res.ok) {
    const body = await res.text();
    console.error(`[gemini] 실패 status=${res.status} ${res.statusText} (${elapsedMs}ms) model=${model}`);
    console.error(`[gemini] 에러 본문 원문: ${body}`);
    throw new Error(`Gemini API 호출 실패 (${res.status}): ${body}`);
  }

  console.log(`[gemini] 성공 status=${res.status} (${elapsedMs}ms) model=${model}`);

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // 200인데 텍스트가 없는 경우(안전필터 차단 등) — 판단 근거가 되도록 응답을 함께 남긴다
    console.error(`[gemini] 200이지만 텍스트 없음 model=${model}: ${JSON.stringify(data).slice(0, 800)}`);
    throw new Error('Gemini 응답에 텍스트가 없습니다.');
  }
  return text;
}

/** Gemini 응답 텍스트에서 JSON을 최대한 안전하게 파싱 */
export function parseGeminiJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // 코드펜스나 앞뒤 잡음이 섞인 경우 첫 { ~ 마지막 } 만 추출해 재시도
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('JSON 블록을 찾지 못했습니다.');
  }
}
