/**
 * cutsceneData.js — 서점 액자 스토리 컷신 대본
 *
 * 장면(scene) 객체:
 *   background : 배경 이미지 경로. **생략하면 이전 장면의 배경을 그대로 유지**한다.
 *   character  : 배경 위에 얹을 인물 이미지(투명 PNG) 경로.
 *                **생략/null이면 인물이 사라진다** (배경과 달리 유지되지 않는다).
 *   lines      : 한 줄씩 순차 타이핑되는 대사/내레이션 배열
 *   bgm        : (예약) 지금은 비워둠
 *
 * 대사 안의 토큰은 josa.js의 formatLine이 치환한다.
 *   {학습자이름} → 이름,  {은/는} {이/가} → 앞 글자 받침에 맞춘 조사
 *
 * 이미지 파일이 없어도 컷신은 정상 진행된다 —
 * 배경은 장면별 그라데이션으로, 인물은 "표시 안 함"으로 대체된다.
 */

/**
 * 배경 이미지 — 화면 전체를 덮는다 (cover).
 * 사진형 이미지라 JPEG를 쓴다 (같은 화질에 PNG의 1/10 용량).
 */
export const CUTSCENE_BG = {
  street: '/assets/cutscene/street.jpg',
  alley: '/assets/cutscene/alley.jpg',
  bookstore: '/assets/cutscene/bookstore.jpg',
  bookCover: '/assets/cutscene/book_cover.jpg',
  bookOpen: '/assets/cutscene/book_open.jpg',
  bookstoreNight: '/assets/cutscene/bookstore_night.jpg',
};

/**
 * 인물 이미지 — 배경 위에 얹는 레이어.
 * 배경이 비쳐야 하므로 **반드시 투명 PNG**를 쓴다 (JPEG는 투명도가 없다).
 * 노주인은 표정 분기 없이 owner.png 하나로 통일한다.
 */
export const CUTSCENE_CHAR = {
  owner: '/assets/cutscene/owner.png',
};

/**
 * 오프닝 — 게임 진입 후 트랙 선택 직전 1회
 *
 * 한 줄이 곧 한 번의 타이핑 단위다. 너무 짧게 끊으면 문장이 툭툭 튀므로,
 * 의미가 이어지는 부분은 한 줄로 합쳐 자연스러운 호흡을 만든다.
 */
export const OPENING_SCENES = [
  {
    background: CUTSCENE_BG.street,
    bgm: null,
    lines: [
      '오늘도 그랬다. 누군가를 설득하지 못하고, 하고 싶은 말은 삼킨 채, {학습자이름}{은/는} 결국 손해만 보고 돌아가는 길이었다.',
      '"왜 나는 매번 이 모양일까…" 무거운 마음이 발끝까지 내려앉았다.',
    ],
  },
  {
    background: CUTSCENE_BG.alley,
    bgm: null,
    lines: [
      '정처 없이 걷다 보니, 어느새 처음 보는 낯선 골목에 들어서 있었다.',
      '골목 끝, 작은 서점 하나에 홀로 불이 켜져 있었다.',
    ],
  },
  {
    // 노주인이 처음 말을 거는 장면 — 서점 배경 위에 인물을 얹는다
    background: CUTSCENE_BG.bookstore,
    character: CUTSCENE_CHAR.owner,
    bgm: null,
    lines: [
      '홀린 듯 문을 밀고 들어서자, 노주인이 고개를 들어 나를 가만히 바라보았다.',
      '"설득의 왕이 되고 싶은가?"',
      '"…네?"',
      '"그렇다면 이 책을 펴 보게. 이 안에 자네가 찾던 답이 있을지도 모르니."',
    ],
  },
  {
    // 책 표지 클로즈업 — 인물은 화면에서 빠진다
    background: CUTSCENE_BG.bookCover,
    character: null,
    bgm: null,
    lines: ['그가 건넨 낡은 책의 표지에는, 오래된 금박으로 이렇게 적혀 있었다.', '【 설득의 정석 】'],
  },
  {
    background: CUTSCENE_BG.bookOpen,
    bgm: null,
    lines: [
      '{학습자이름}{이/가} 첫 장을 넘기자, 글자들이 스르르 흐려지더니 —',
      '어느새 나는, 책 속 어느 낯선 사람의 자리에 서 있었다.',
    ],
  },
];

/**
 * 아웃트로 — 트랙 선택 화면에서 [게임 마치기]를 눌렀을 때 재생한다.
 * 한 트랙만 마쳤든 두 트랙을 다 마쳤든, 마무리 시점은 학습자가 고른다.
 *
 * 마지막 "책값 흥정"은 여운을 남기는 연출까지만 — 실제 흥정 입력·채점은 넣지 않는다.
 */
export const OUTRO_SCENES = [
  {
    background: CUTSCENE_BG.bookstoreNight,
    bgm: null,
    lines: [
      '마지막 페이지를 덮자, 어느새 나는 다시 그 서점 안에 서 있었다.',
      '창밖을 보니 해는 저물어 거리가 어둑했다. 얼마나 오래 이 책 속에 있었던 걸까.',
    ],
  },
  {
    // 노주인 등장 — 밤 서점 배경을 유지한 채 인물만 얹는다
    background: CUTSCENE_BG.bookstoreNight,
    character: CUTSCENE_CHAR.owner,
    bgm: null,
    lines: [
      '노주인이 잔잔한 미소를 머금고 물었다.',
      '"어떤가, {학습자이름}. 이제 자네만의 설득법이 조금은 생겼는가?"',
    ],
  },
  {
    // 여운 — 인물을 빼고 책 펼침 연출로 전환
    background: CUTSCENE_BG.bookOpen,
    character: null,
    bgm: null,
    lines: [
      '나는 대답 대신, 손에 남은 책의 온기를 가만히 느꼈다.',
      '설득이란 상대를 이기는 일이 아니라, 상대의 진짜 마음을 읽는 일이었다.',
    ],
  },
  {
    // 마지막 흥정 — 다시 밤 서점으로 돌아와 노주인을 세운다
    background: CUTSCENE_BG.bookstoreNight,
    character: CUTSCENE_CHAR.owner,
    bgm: null,
    lines: [
      '노주인이 장난스레 덧붙였다.',
      '"그럼 마지막으로… 이 책, 얼마면 사겠나? 값은 자네가 정하게. 단, 나를 설득해 보게."',
      '(그리고 그는, 대답을 기다리듯 빙그레 웃었다.)',
    ],
  },
];
