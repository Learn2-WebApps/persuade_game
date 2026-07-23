/**
 * assets.js — 대화 화면 에셋 경로 규칙 (한 곳에서만 관리)
 *
 * 실제 이미지 파일은 public/assets/ 아래에 규칙대로 넣기만 하면 자동으로 표시된다.
 * (Vite가 public/ 을 그대로 서빙하므로 빌드 설정을 건드릴 필요 없음)
 *
 * ── 배경 ──────────────────────────────────────────────
 *   public/assets/{track}/bg/{stageId}.jpg     1920x1080 가로형
 *   예) public/assets/work/bg/stage1.jpg
 *   스테이지 데이터에 background(또는 backgroundImage) 필드가 있으면 그 값이 우선한다.
 *
 * ── 캐릭터 ────────────────────────────────────────────
 *   public/assets/{track}/{characterKey}/{emotion}.png   투명 PNG 세로형
 *   emotion = very_happy | happy | normal | worry | angry  (5단계)
 *   예) public/assets/work/jimin/happy.png
 *   스테이지 데이터의 assetMap[emotion] 값이 우선한다 (stageData.js가 이미 이 규칙으로 넣어둠).
 *
 * 파일이 없으면 이미지 로드 실패를 감지해 플레이스홀더로 폴백한다 (깨진 이미지 아이콘 방지).
 */

export const EMOTIONS = ['very_happy', 'happy', 'normal', 'worry', 'angry'];

/** 배경 기본 경로 */
export const backgroundPath = (track, stageId) => `/assets/${track}/bg/${stageId}.jpg`;

/** 캐릭터 기본 경로 */
export const characterPath = (track, characterKey, emotion) =>
  `/assets/${track}/${characterKey}/${emotion}.png`;

/**
 * 스테이지에서 배경 경로를 뽑는다.
 * 우선순위: stage.background > stage.backgroundImage > 규칙 경로
 */
export function resolveBackground(stage, track, stageId) {
  return stage?.background || stage?.backgroundImage || backgroundPath(track, stageId);
}

/**
 * 스테이지에서 감정별 캐릭터 경로를 뽑는다.
 * 우선순위: stage.assetMap[emotion] > 규칙 경로(characterKey 추정)
 * characterKey는 stage.characterKey가 있으면 그것을, 없으면 assetMap 경로에서 유추한다.
 */
export function resolveCharacter(stage, track, emotion) {
  const fromMap = stage?.assetMap?.[emotion];
  if (fromMap) return fromMap;

  const key = stage?.characterKey || guessCharacterKey(stage);
  return key ? characterPath(track, key, emotion) : null;
}

/** assetMap 경로에서 캐릭터 폴더명을 유추 (…/{characterKey}/{emotion}.png) */
function guessCharacterKey(stage) {
  const sample = stage?.assetMap && Object.values(stage.assetMap)[0];
  if (typeof sample !== 'string') return null;
  const parts = sample.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

// ─────────────────────────────────────────────────────────────
// 프리로딩 — 대화 중 첫 표정 전환이 끊기지 않도록 미리 브라우저 캐시에 올린다.
// ─────────────────────────────────────────────────────────────

/**
 * 이미 요청한 URL 집합. 같은 이미지를 두 번 네트워크로 받지 않도록 막는다.
 * (문자열만 담으므로 메모리 부담이 없다. Image 객체는 참조를 남기지 않아
 *  스테이지를 벗어나면 GC 대상이 된다 — 이전 스테이지 이미지를 붙들지 않는다.)
 */
const _requested = new Set();

/**
 * 이미지 한 장을 백그라운드로 미리 로드한다.
 * 로드 실패해도 조용히 무시한다 — 실제 표시는 각 화면의 fallback(placeholder/normal)이 담당하므로
 * 프리로딩이 실패해도 화면 동작에는 아무 영향이 없다.
 * @param {string|null} src
 */
export function preloadImage(src) {
  if (!src || _requested.has(src)) return;
  _requested.add(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = src; // onload/onerror 핸들러 없이 캐시만 데운다
}

/**
 * 한 스테이지의 대화용 에셋(배경 + 캐릭터 5표정)을 미리 로드한다.
 * 스테이지 진입 직전(브리핑 화면)에 호출하면, 학습자가 브리핑을 읽는 동안
 * 이미지가 캐시에 올라가 첫 표정 전환이 즉시 이루어진다.
 * @param {object} stage
 * @param {string} track
 * @param {string} [stageId] - 없으면 stage.id 사용
 */
export function preloadStageAssets(stage, track, stageId = stage?.id) {
  if (!stage) return;
  preloadImage(resolveBackground(stage, track, stageId));
  for (const emotion of EMOTIONS) {
    preloadImage(resolveCharacter(stage, track, emotion));
  }
}
