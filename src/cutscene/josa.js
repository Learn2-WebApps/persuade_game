/**
 * josa.js — 한글 조사 자동 선택
 *
 * 마지막 글자의 받침(종성) 유무로 조사를 고른다.
 * 한글 음절은 유니코드 U+AC00부터 (초성 19 × 중성 21 × 종성 28) 순서로 배열되므로
 *   (코드 - 0xAC00) % 28 === 0  →  종성 없음(받침 없음)
 */

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JONGSUNG_COUNT = 28;

/** 종성 인덱스 (받침 없음이면 0). 한글 음절이 아니면 null. */
function jongseongIndex(char) {
  if (!char) return null;
  const code = char.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  return (code - HANGUL_BASE) % JONGSUNG_COUNT;
}

/**
 * 마지막 글자에 받침이 있는지.
 * 한글이 아닌 경우(영문·숫자)는 발음 기준으로 추정한다.
 * 판단이 불가능하면 null을 돌려 호출부가 기본값을 쓰게 한다.
 */
export function hasBatchim(word) {
  const s = String(word ?? '').trim();
  if (!s) return null;
  const last = s[s.length - 1];

  const jong = jongseongIndex(last);
  if (jong !== null) return jong !== 0;

  // 숫자: 읽는 소리의 받침 유무 (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 → 받침 있음)
  if (/[0-9]/.test(last)) return ['0', '1', '3', '6', '7', '8'].includes(last);

  // 영문: 받침처럼 끝나는 자음으로 끝나면 받침 있음으로 본다 (완벽하진 않은 근사)
  if (/[a-zA-Z]/.test(last)) return !'aeiouyAEIOUY'.includes(last);

  return null;
}

/** 'ㄹ' 받침인지 — '으로/로' 판정에 필요 */
function hasRieulBatchim(word) {
  const s = String(word ?? '').trim();
  if (!s) return false;
  return jongseongIndex(s[s.length - 1]) === 8; // 8 = ㄹ
}

/**
 * 조사 쌍 문자열을 [받침있을때, 받침없을때]로 분해한다.
 * '은는' / '은/는' 둘 다 받는다. '으로로' / '으로/로' 같은 2글자 조사도 지원.
 */
function splitPair(pair) {
  const p = String(pair).replace(/\s/g, '');
  if (p.includes('/')) {
    const [withB, withoutB] = p.split('/');
    return [withB, withoutB];
  }
  // 알려진 2글자 조사 먼저 처리
  if (p === '으로로') return ['으로', '로'];
  if (p === '이여여') return ['이여', '여'];
  // 나머지는 한 글자씩
  return [p[0], p[1]];
}

/**
 * 단어에 맞는 조사를 돌려준다 (조사만 반환 — 단어는 붙이지 않는다).
 * @param {string} word 앞 단어 (예: 학습자 이름)
 * @param {string} pair '은는' | '은/는' | '이가' | '을를' | '과와' | '아야' | '으로로' …
 * @returns {string} 선택된 조사
 *
 * 예) attachJosa('민준', '은는') → '은'   (받침 O)
 *     attachJosa('지수', '은는') → '는'   (받침 X)
 */
export function attachJosa(word, pair) {
  const [withBatchim, withoutBatchim] = splitPair(pair);

  // '으로/로'는 ㄹ 받침도 '로'를 쓴다 ("서울로", "학교로")
  if (withBatchim === '으로' && hasRieulBatchim(word)) return withoutBatchim;

  const batchim = hasBatchim(word);
  if (batchim === null) return withoutBatchim; // 판단 불가 → 받침 없는 형태
  return batchim ? withBatchim : withoutBatchim;
}

/** 단어 + 조사를 붙여서 반환 (예: '민준은') */
export function withJosa(word, pair) {
  return `${word}${attachJosa(word, pair)}`;
}

/**
 * 컷신 대사 템플릿을 실제 문장으로 만든다.
 *
 * 지원 토큰:
 *   {학습자이름} 또는 {이름}  → vars.name
 *   {레벨} {칭호} {코멘트} 등 → vars의 같은 이름 키
 *   {은/는} {이/가} {을/를} {과/와} {아/야} {으로/로} → 바로 앞 단어 기준 조사
 *
 * 조사 토큰은 앞에 치환된 실제 글자를 보고 판단하므로,
 * 이름 치환 → 조사 치환 순서로 처리한다.
 */
export function formatLine(template, vars = {}) {
  const aliases = { 학습자이름: 'name', 이름: 'name' };

  // 1) 이름·레벨 등 값 토큰 치환
  let out = String(template).replace(/\{([^{}/]+)\}/g, (match, key) => {
    const k = aliases[key] || key;
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : match;
  });

  // 2) 조사 토큰 치환 — 바로 앞 글자를 기준으로 판단
  out = out.replace(/\{([^{}]+)\/([^{}]+)\}/g, (match, a, b, offset) => {
    const before = out.slice(0, offset).trim();
    if (!before) return b;
    return attachJosa(before[before.length - 1], `${a}/${b}`);
  });

  return out;
}
