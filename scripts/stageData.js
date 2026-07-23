/**
 * stageData.js — 트랙별 스테이지 시나리오 + 기본 settings (공용 데이터 모듈)
 *
 * seed.js(데모 룸 시드)와 seed-master.js(마스터 템플릿 시드)가 함께 사용한다.
 * 시나리오 내용을 수정하려면 이 파일만 고치면 된다.
 *
 * ─────────────────────────────────────────────────────────────
 * [트랙 구조]
 *   work — 업무 설득 트랙 (직장 맥락 5스테이지)
 *   life — 일상 설득 트랙 (생활 맥락 5스테이지)
 * 두 트랙은 채점 기준(4축 균등)·게이지·저장·리포트 로직을 100% 공유하고,
 * 시나리오 내용만 다르다.
 *
 * [채점 4축 — 두 트랙 공통, 각 25%]
 *   emotion 감정 읽기 / logic 논리·근거 / trust 신뢰 형성 / timing 타이밍
 * 축 판단 기준 자체는 채점 프롬프트(functions/api/score.js)에 있고,
 * 여기 scoringExamples는 그 판단을 돕는 스테이지별 참고 예시다.
 *
 * [scoringExamples 형식]
 *   high/mid/low 각각 배열이며, 항목은 { utterance, axes, reason }.
 *   axes는 SCORING_AXES의 key 배열 — 한 단계 안에서 4축이 골고루 담기도록 작성한다.
 * ─────────────────────────────────────────────────────────────
 */

/** 에셋 경로 헬퍼 — 시나리오가 assetMap을 직접 지정하지 않을 때만 쓴다. */
const makeAssetMap = (trackDir, charDir) => ({
  very_happy: `/assets/${trackDir}/${charDir}/very_happy.png`,
  happy: `/assets/${trackDir}/${charDir}/happy.png`,
  normal: `/assets/${trackDir}/${charDir}/normal.png`,
  worry: `/assets/${trackDir}/${charDir}/worry.png`,
  angry: `/assets/${trackDir}/${charDir}/angry.png`,
});

/** 채점 4축 — 모든 스테이지에 균등(각 25%) 적용된다. */
const SCORING_AXES = [
  { key: 'emotion', label: '감정 읽기', weight: 0.25 },
  { key: 'logic', label: '논리·근거', weight: 0.25 },
  { key: 'trust', label: '신뢰 형성', weight: 0.25 },
  { key: 'timing', label: '타이밍', weight: 0.25 },
];

const DEFAULT_SETTINGS = {
  activeRounds: 5,
  stageTimeLimit: 300, // 초 (5분)
  maxMessagesPerStage: 15,
  evalModel: 'gemini-3-flash-preview',
  reportModel: 'gemini-3-flash-preview',
};

/** 트랙 표시 정보 — 관리자 선택지·스테이지맵 상단 트랙명에 쓰인다. */
const TRACK_META = {
  work: { key: 'work', label: '업무 설득 트랙', shortLabel: '업무' },
  life: { key: 'life', label: '일상 설득 트랙', shortLabel: '일상' },
};

// ─────────────────────────────────────────────────────────────
// 업무(WORK) 트랙
// ─────────────────────────────────────────────────────────────
const WORK_SCENARIOS = [
  {
    order: 1,
    title: '위축된 후배 다시 일으키기',
    characterName: '지민',
    characterType: '후배',
    situation:
      '금요일 저녁, 회의가 끝난 사무실. 후배 지민이 남아 멍하니 모니터를 바라본다. 몇 주간 공들인 기획안이 상부 결정으로 방향이 완전히 틀어졌고, 오늘 회의에서 그 노력은 언급조차 되지 않았다. 다음 주부터 새 프로젝트가 시작되는데, 지민의 표정에는 의욕이 보이지 않는다.',
    introDialogue: '아… 선배님. 저 그냥 좀 지쳤나 봐요. 제가 뭘 해도 어차피 바뀌는데 의미가 있나 싶고요.',
    situationBrief:
      "금요일 저녁의 사무실. 후배 '지민'이 며칠째 표정이 어둡다. 공들인 기획이 엎어진 뒤로 눈에 띄게 위축되어 있다.",
    goalBrief: "지민이 마음을 열고 다시 힘을 낼 수 있도록 대화를 이끌어보자.",
    persuasionTip:
      "사람은 논리보다 '마음'으로 먼저 움직인다. 해결책을 꺼내기 전에 상대의 감정을 먼저 읽고 인정해 주자. \"네 잘못이 아니야\"보다 \"얼마나 속상했을지 알아\" 한마디가 닫힌 문을 연다.",
    surfaceNeed: '그냥 지쳤다, 쉬고 싶다',
    hiddenNeed: '기여를 인정받지 못한 무력감, 성장 정체에 대한 불안',
    hiddenNeedClue:
      '솔직히… 제가 몇 주를 매달린 건데 회의에서 한마디도 안 나오니까, 제가 여기 있는 이유를 모르겠어요.',
    persuasionGoal: "마음을 열고 '사실은요…' 하며 진짜 속내를 털어놓게 하기",
    resistancePoints: [
      "성급한 위로에는 '괜찮아요, 별거 아니에요'라며 물러선다.",
      "해결책부터 던지면 '그런 걸 원한 게 아니라'며 마음을 닫는다.",
      "일반화('다들 그래')하면 감정이 무시됐다고 느낀다.",
    ],
    scoringExamples: {
      high: [
        {
          utterance: '지민 님이 그 기획안에 얼마나 공들였는지 옆에서 다 봤어요. 그게 이렇게 흘러가서 저도 속상하네요.',
          axes: ['emotion', 'trust'],
          reason: '구체적 기여를 인정하며 감정을 진심으로 공감',
        },
        {
          utterance: '지금 당장 뭘 하자는 게 아니라, 요즘 뭐가 제일 힘든지 그냥 듣고 싶어서요.',
          axes: ['timing', 'emotion'],
          reason: '지친 상태를 읽고 압박 대신 여백을 줌',
        },
      ],
      mid: [
        {
          utterance: '다음 프로젝트에선 지민 님 아이디어를 꼭 반영되게 제가 챙길게요.',
          axes: ['logic'],
          reason: '실행 약속은 있으나 감정 선행 없이 해결책부터 제시',
        },
        {
          utterance: '사실 그 기획안 아이디어 중에 다음에 쓸 수 있는 게 많아요. 하나씩 정리해볼까요?',
          axes: ['logic', 'trust'],
          reason: '건설적 제안이나 감정 회복이 우선되지 않음',
        },
      ],
      low: [
        {
          utterance: '누구나 다 겪는 일이야, 너무 예민하게 생각하지 마.',
          axes: ['emotion', 'trust'],
          reason: '감정 무시·일반화로 신뢰 하락',
        },
        {
          utterance: '그래서 결론이 뭐예요, 계속할 거예요 말 거예요?',
          axes: ['timing', 'emotion'],
          reason: '마음이 닫힌 상태에서 몰아붙여 역효과',
        },
      ],
    },
    assetMap: makeAssetMap('work', 'jimin'),
  },
  {
    order: 2,
    title: '실패를 기억하는 부장 설득하기',
    characterName: '정 부장',
    characterType: '상사',
    situation:
      '신사업 기획 회의. 당신이 새로운 방식을 제안하려 하자, 정 부장은 2년 전 비슷한 시도가 크게 실패해 본인이 문책당했던 기억을 떠올린다. 팔짱을 끼는 부장의 표정에서 경계심이 읽힌다.',
    introDialogue: '그거… 예전에 우리가 해봤잖아요. 그때 어떻게 됐는지 알죠? 뭐가 다른데요?',
    situationBrief:
      "회의실. 정 부장은 예전 비슷한 프로젝트의 실패를 또렷이 기억한다. 같은 실수를 반복할까 봐 경계하고 있다.",
    goalBrief: "부장이 \"그 정도 안전장치면 해볼 만하다\"고 조건부로 수락하게 만들자.",
    persuasionTip:
      "지금은 감정만으론 부족하다. 상대가 두려워하는 '위험'을 구체적인 근거와 대비책으로 덜어줘야 한다. 막연한 자신감이 아니라, 무엇이 다른지·어떻게 막을지를 명확히 보여주자.",
    surfaceNeed: '검증 안 된 아이디어는 안 된다',
    hiddenNeed: '또 실패하면 이번엔 내가 책임진다는 두려움, 통제감 확보',
    hiddenNeedClue: '그때 나도 위에서 얼마나 깨졌는지 몰라요. 또 그런 일 생기면… 이번엔 진짜 감당 안 돼요.',
    persuasionGoal: "'그 정도 안전장치면… 한번 해봅시다'라고 조건부 수락하게 하기",
    resistancePoints: [
      "장점만 나열하면 '그건 그때도 그렇게 말했어'로 반박한다.",
      '과거 실패를 축소하면 신뢰를 잃는다.',
      "'뭐가 다른데?'라는 질문에 구체적 답이 없으면 닫힌다.",
    ],
    scoringExamples: {
      high: [
        {
          utterance:
            '그때 실패가 부장님께 얼마나 부담이었을지 알 것 같아요. 그래서 이번엔 실패해도 손실을 이 선에서 막을 안전장치를 먼저 준비했어요.',
          axes: ['emotion', 'logic', 'trust'],
          reason: '두려움을 인정하고 구체적 리스크 통제책 제시',
        },
        {
          utterance: '이번엔 세 가지가 결정적으로 달라요. A는 그때 없던 데이터고, B는 소규모 검증부터 갑니다.',
          axes: ['logic'],
          reason: '과거와의 차이와 단계적 검증을 명확한 근거로 제시',
        },
        {
          utterance: '오늘 결정하시라는 거 아니에요. 소규모 검증 결과 보시고 그때 판단하셔도 늦지 않습니다.',
          axes: ['timing', 'trust'],
          reason: '판단 시점을 상대에게 넘겨 경계가 높은 국면에서 압박을 조절',
        },
      ],
      mid: [
        {
          utterance: '부장님 걱정 충분히 이해해요. 그래도 한번 믿어주시면 안 될까요?',
          axes: ['emotion'],
          reason: '감정은 읽었으나 근거 없이 감정 호소만',
        },
        {
          utterance: '지금 시장 상황이 그때랑 많이 달라졌어요.',
          axes: ['logic'],
          reason: '차이의 단서는 있으나 구체성 부족',
        },
      ],
      low: [
        {
          utterance: '그때 실패는 사실 운이 없었던 거죠. 이번엔 다를 거예요.',
          axes: ['logic', 'trust'],
          reason: '과거 축소로 신뢰 하락, 근거 부재',
        },
        {
          utterance: '부장님, 시대가 바뀌었는데 언제까지 예전 생각만 하실 거예요?',
          axes: ['emotion', 'trust'],
          reason: '존중 결여·감정 자극으로 신뢰 붕괴',
        },
        {
          utterance: '이거 지금 당장 승인 안 해주시면 저희 일정 다 밀려요.',
          axes: ['timing', 'emotion'],
          reason: '아직 경계를 풀지 않은 상대를 몰아붙여 역효과',
        },
      ],
    },
    assetMap: makeAssetMap('work', 'boojang'),
  },
  {
    order: 3,
    title: '이미 경쟁사를 믿는 고객 설득하기',
    characterName: '김 팀장',
    characterType: '고객',
    situation:
      '거래처 미팅룸. 결정권을 가진 김 팀장은 경쟁사 제품을 오래 써왔고 그쪽 담당자와 친분도 두텁다. 당신은 처음 만나는 사람이고, 아직 신뢰가 쌓이지 않았다.',
    introDialogue: '솔직히 지금 쓰는 것도 큰 문제 없어서요. 굳이 바꿀 이유가 있을까 싶은데…',
    situationBrief:
      "고객사 미팅룸. 김 팀장은 이미 경쟁사를 오래 신뢰해 왔다. 굳이 거래처를 바꿀 이유를 느끼지 못한다.",
    goalBrief: "\"그렇게까지 책임진다면 검토는 해보겠다\"며 문을 열게 만들자.",
    persuasionTip:
      "이미 다른 곳을 믿는 상대에겐, 화려한 자랑이나 경쟁사 깎아내리기가 오히려 독이다. 먼저 신뢰를 쌓자. 검증된 사례와 \"내가 끝까지 책임진다\"는 솔직하고 투명한 태도가 마음을 연다.",
    surfaceNeed: '바꿀 필요를 못 느낀다',
    hiddenNeed: '새 업체로 갈아탔다가 문제 생기면 내가 책임진다는 불안',
    hiddenNeedClue: '바꿨다가 삐끗하면 그거 다 제 책임이 되는 거라서요. 지금 잘 굴러가는 걸 굳이…',
    persuasionGoal: "'그렇게까지 책임진다면, 검토는 해볼게요'라고 문을 열게 하기",
    resistancePoints: [
      "가격 할인으로 밀면 '돈 문제가 아니라'며 물러선다.",
      '경쟁사를 깎아내리면 오히려 방어적이 된다.',
      '과장된 자기 자랑은 신뢰를 떨어뜨린다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: '바꾸는 게 팀장님께 리스크라는 거 잘 알아요. 그래서 문제가 생기면 저희가 어떻게 책임지는지부터 말씀드릴게요.',
          axes: ['emotion', 'trust'],
          reason: '책임 부담을 읽고 책임 구조로 신뢰 형성',
        },
        {
          utterance: '저희랑 비슷한 업종 두 곳이 작년에 넘어왔는데, 초기 3개월은 병행 운영으로 리스크를 줄였어요.',
          axes: ['logic', 'trust'],
          reason: '검증 사례와 리스크 완화 방안 제시',
        },
      ],
      mid: [
        {
          utterance: '지금 쓰시는 것도 좋은 제품이죠. 다만 저희는 이런 부분이 더 나아요.',
          axes: ['trust'],
          reason: '경쟁사 존중은 있으나 상대 불안엔 미접근',
        },
        {
          utterance: '오늘 결정 안 하셔도 돼요. 자료만 보시고 편하게 판단하세요.',
          axes: ['timing'],
          reason: '압박을 조절했으나 신뢰 근거 제시는 부족',
        },
      ],
      low: [
        {
          utterance: '지금 쓰시는 거 그거 사실 문제 많아요. 다들 저희로 옮기는 추세예요.',
          axes: ['trust'],
          reason: '경쟁사 폄하·과장으로 신뢰 하락',
        },
        {
          utterance: '이번 주 안에 계약하시면 20% 깎아드릴게요.',
          axes: ['logic', 'emotion'],
          reason: '상대 불안 미접근, 할인으로만 밀어붙임',
        },
      ],
    },
    assetMap: makeAssetMap('work', 'kimteam'),
  },
  {
    order: 4,
    title: '긴급 결재 받아내기',
    characterName: '대표',
    characterType: '상사',
    situation:
      '목요일 오후, 대표는 다음 주 이사회 준비로 극도로 예민하다. 당신에겐 이번 주 안에 결정하지 못하면 사라지는 파트너십 기회가 있다. 대표의 책상엔 서류가 쌓여 있고, 표정엔 여유가 없다.',
    introDialogue: '지금 그거 볼 여유 없어요. 이사회 끝나고 다음 주에 다시 가져와요.',
    situationBrief:
      "대표 집무실. 대표는 지금 극도로 바쁘고, 곧 이사회 준비가 있다. 긴급한 협업 기회가 생겼지만 대표에겐 시간이 없다.",
    goalBrief: "대표가 \"좋아, 5분 줄게. 결정만 하면 되는 거지?\"라며 시간을 내주게 하자.",
    persuasionTip:
      "바쁜 사람에겐 타이밍이 전부다. 길게 끌지 말고 지금 결정할 수 있게 핵심만. 상대의 부담을 줄여주는 '5분이면 됩니다' 한마디가, 잘 짜인 긴 설명보다 강할 때가 있다.",
    surfaceNeed: '바쁘다, 다음에',
    hiddenNeed: '지금 새 리스크를 떠안을 여유가 없다, 부담을 지고 싶지 않다',
    hiddenNeedClue: '안 그래도 이번 주는 머리가 터질 것 같은데, 여기서 뭐 하나 더 얹으면…',
    persuasionGoal: "'좋아, 5분 줄게. 결정만 하면 되는 거지?'라고 시간을 내주게 하기",
    resistancePoints: [
      "중요성만 길게 설명하면 '그래서 다음에'로 튕겨낸다.",
      '대표의 현재 상황(이사회)을 무시하면 반감을 산다.',
      '압박·위협조로 접근하면 마음을 닫는다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: '이사회 준비로 정신없으신 거 알아요. 그래서 5분만, 결정만 해주시면 실행은 제가 다 책임지고 진행할게요.',
          axes: ['timing', 'emotion', 'trust'],
          reason: '상황을 인정하고 부담을 최소화하며 책임을 짊어짐',
        },
        {
          utterance: '이번 주를 넘기면 경쟁사가 먼저 계약해서 이 기회 자체가 사라져요. 그래서 다음 주는 너무 늦어요.',
          axes: ['logic', 'timing'],
          reason: '시급성의 근거를 명확히 제시',
        },
      ],
      mid: [
        {
          utterance: '핵심만 세 줄로 정리해왔어요. 이것만 보시면 됩니다.',
          axes: ['timing'],
          reason: '부담을 줄였으나 시급성 근거가 약함',
        },
        {
          utterance: '대표님 판단만 필요한 거라, 세부 검토는 제가 이미 다 끝냈어요.',
          axes: ['trust'],
          reason: '부담을 대신 짊어졌으나 타이밍·근거 결합 부족',
        },
      ],
      low: [
        {
          utterance: '이거 진짜 중요한 거라서요, 잠깐만 시간 내주세요. 설명드릴 게 좀 많은데…',
          axes: ['timing'],
          reason: '바쁜 상대에게 장황해 타이밍 실패',
        },
        {
          utterance: '지금 안 보시면 나중에 후회하실 거예요.',
          axes: ['emotion', 'trust'],
          reason: '위협조로 감정·신뢰 하락',
        },
      ],
    },
    assetMap: makeAssetMap('work', 'ceo'),
  },
  {
    order: 5,
    title: '마음이 갈라진 회의실',
    characterName: '팀 (다수)',
    characterType: '회의 참석자들',
    situation:
      '프로젝트 방향을 바꾸자는 당신의 제안을 두고 팀 전체가 모였다. 실무 부담을 걱정하는 주니어, 과거 실패를 떠올리는 시니어, 성과 수치를 따지는 팀장, 현상 유지를 원하는 사람까지 입장이 제각각이다. 한 사람에게 통하는 말이 다른 사람에겐 역효과다.',
    introDialogue: '각자 생각이 다른 것 같은데… 굳이 지금 방향을 바꿔야 하는 이유가 뭐죠? 다들 걱정이 많아 보여요.',
    situationBrief:
      "대회의실. 여러 입장이 엇갈린다. 일이 늘까 걱정인 후배, 회의적인 선배, 성과 지표만 보는 관리자, 현상 유지를 원하는 사람까지.",
    goalBrief: "가장 회의적이던 사람이 \"그 정도면 해볼 만하네요\"라고 돌아서게 하자.",
    persuasionTip:
      "한 가지 방법으로 모두를 설득할 순 없다. 사람마다 걱정이 다르다. 각자가 '내가 손해 보지 않는다'고 느끼도록, 감정·근거·신뢰·타이밍을 상대에 맞춰 달리 써야 한다.",
    surfaceNeed: '각자 다른 반대 이유 (부담·위험·수치·현상 유지)',
    hiddenNeed: "공통적으로 '이 변화가 나에게 손해가 아니라는 확신'",
    hiddenNeedClue: '(주니어) 바뀌면 결국 일 늘어나는 건 저희잖아요. / (시니어) 예전에도 이러다 엎어진 적 있어서요.',
    persuasionGoal: "가장 회의적이던 사람이 '그 정도면 해볼 만하네요'라고 돌아서게 하기",
    resistancePoints: [
      '모두에게 같은 논리를 반복하면 각자 자기 걱정이 무시됐다고 느낀다.',
      '강하게 밀어붙이면 다수가 방어적으로 결집한다.',
      '한 사람만 설득하면 다른 사람에게 역효과가 난다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: '주니어분들 걱정처럼 초반엔 일이 늘 수 있어요. 그래서 그 부분은 제가 먼저 부담을 나눠 지는 구조로 짜왔습니다.',
          axes: ['emotion', 'trust'],
          reason: '개별 불안을 짚고 부담 분담으로 신뢰 형성',
        },
        {
          utterance: '시니어님 말씀처럼 예전 실패가 걱정되니까, 이번엔 소규모 검증부터 하고 안 되면 바로 되돌릴 수 있게 했어요.',
          axes: ['logic', 'emotion'],
          reason: '우려를 인정하고 리스크 통제책 제시',
        },
        {
          utterance: '팀장님 우려하는 수치는 이 자료에 있고, 우선 걱정 많으신 분부터 한 분씩 얘기 나눠보면 어떨까요?',
          axes: ['logic', 'timing'],
          reason: '근거 제시 + 순차적 우군 확보 판단',
        },
      ],
      mid: [
        {
          utterance: '다들 걱정되는 마음은 알겠어요. 그래도 이게 우리한테 필요한 변화예요.',
          axes: ['emotion'],
          reason: '공감은 있으나 개별 니즈를 분리하지 못함',
        },
      ],
      low: [
        {
          utterance: '결국 회사를 위한 거니까 다 같이 따라와 주셨으면 해요.',
          axes: ['emotion', 'trust'],
          reason: '개별 불안 무시, 일방적 호소',
        },
        {
          utterance: '반대하시는 분들은 대안이 있나요? 없으면 그냥 진행하죠.',
          axes: ['emotion', 'trust'],
          reason: '압박·존중 결여로 다수 결집 유발',
        },
      ],
    },
    assetMap: makeAssetMap('work', 'team'),
  },
];

// ─────────────────────────────────────────────────────────────
// 일상(LIFE) 트랙
// ─────────────────────────────────────────────────────────────
const LIFE_SCENARIOS = [
  {
    order: 1,
    title: '부모님께 반려동물 입양 허락받기',
    characterName: '엄마',
    characterType: '부모님',
    situation:
      "일요일 저녁, 거실. 며칠 전부터 강아지 입양 이야기를 꺼내고 싶었던 당신. TV를 보던 엄마 옆에 앉는다. 유기견 보호소 사진을 몇 번이나 봤지만, 부모님은 예전부터 '집에서 동물은 안 된다'는 입장이었다. 엄마의 표정에는 이미 '또 그 얘기냐'는 기색이 살짝 스친다.",
    introDialogue: '얘기 나오려는 거 알아. 근데 우리 집 좁고, 결국 다 엄마가 치우게 될 거잖아. 안 돼.',
    situationBrief:
      "집 거실. 반려동물을 입양하고 싶지만, 엄마는 책임과 뒷감당을 걱정하며 반대하는 입장이다.",
    goalBrief: "엄마가 \"그렇게까지 계획을 세웠으면 한 달 지켜보자\"고 조건부로 허락하게 만들자.",
    persuasionTip:
      "감정으로 조르기 전에, 상대의 걱정을 먼저 인정하자. 그리고 그 걱정을 덜어줄 구체적인 계획(내가 어떻게 책임질지)을 보여주면, 반대가 '조건부 허락'으로 바뀐다.",
    surfaceNeed: '집이 좁다, 손이 많이 간다',
    hiddenNeed: '결국 관리는 내(엄마) 몫이 될 거라는 부담, 네가 끝까지 책임질 수 있겠냐는 미덥지 않음',
    hiddenNeedClue: '너 처음엔 다 잘한다고 하지. 근데 한두 달 지나면 밥 주는 것도 내가 하고 있을 걸? 엄마는 그게 걱정이야.',
    persuasionGoal: "'그렇게까지 계획을 세웠으면… 한 달 지켜보자'라고 조건부 허락하게 하기",
    resistancePoints: [
      "감정에만 호소하면 '마음은 알겠는데 그게 다가 아니야'로 물러선다.",
      '책임 계획 없이 조르면 미덥지 않음이 커진다.',
      '다른 집과 비교하면 반감을 산다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: '엄마가 왜 걱정하는지 알아. 결국 엄마 일 될까 봐 그런 거잖아. 그래서 산책이랑 밥은 내가 시간표까지 짜왔어.',
          axes: ['emotion', 'logic', 'trust'],
          reason: '부담을 정확히 읽고 구체적 책임 계획 제시',
        },
        {
          utterance: '한 달만 유예 기간 두고, 내가 정말 책임지는지 보고 판단해줘도 돼.',
          axes: ['logic', 'trust'],
          reason: '검증 기간을 제안해 신뢰를 얻으려 함',
        },
      ],
      mid: [
        {
          utterance: '내가 진짜 잘 키울게, 밥도 챙기고 산책도 매일 할게.',
          axes: ['trust'],
          reason: '약속은 있으나 구체성·감정 선행 부족',
        },
        {
          utterance: '지금 시험 끝났으니까 시간 많아서 돌볼 수 있어.',
          axes: ['logic'],
          reason: '근거 단서는 있으나 부모 부담엔 미접근',
        },
      ],
      low: [
        {
          utterance: '다른 집은 다 키우는데 우리만 안 돼?',
          axes: ['emotion', 'trust'],
          reason: '비교·감정 자극으로 신뢰 하락',
        },
        {
          utterance: '제발, 진짜 이것만 해주면 뭐든 할게!',
          axes: ['logic', 'timing'],
          reason: '근거 없는 조르기로 설득력 없음',
        },
      ],
    },
    assetMap: makeAssetMap('life', 'mom'),
  },
  {
    order: 2,
    title: '친구에게 빌려준 돈 돌려받기',
    characterName: '친구',
    characterType: '친구',
    situation:
      '카페에서 오랜만에 만난 친구. 두 달 전, 친구가 급하다며 빌려간 돈을 아직 못 받았다. 먼저 갚겠다는 말은 없고, 분위기는 화기애애하다. 돈 얘기를 꺼내면 어색해질까 봐 계속 망설였지만, 오늘은 말해야 한다.',
    introDialogue: '아 맞다, 저번에 진짜 고마웠어. 곧 줄게, 요즘 좀 빠듯해서. 미안 미안.',
    situationBrief:
      "카페. 친구에게 빌려준 돈을 돌려받아야 하는데, 관계가 어색해질까 봐 말 꺼내기가 조심스럽다.",
    goalBrief: "친구가 \"맞아, 미안. 다음 주 수요일까지 꼭 보낼게\"라고 구체적 날짜를 약속하게 하자.",
    persuasionTip:
      "관계를 해치지 않으면서 요구하는 게 핵심이다. 상대를 몰아세우지 말고, 솔직하고 담백하게. 감정을 상하게 하지 않는 타이밍과 말투로 '구체적 약속'을 이끌어내자.",
    surfaceNeed: '곧 줄게 (계속 미룸)',
    hiddenNeed: '돈 얘기로 관계가 어색해지는 게 싫음, 갚을 여유가 빠듯한 상황에 대한 체면',
    hiddenNeedClue: '솔직히 지금 딱 잘라서 언제라고 말하기가 좀 그래서… 재촉하는 것 같아서 너도 말 안 한 거지?',
    persuasionGoal: "'맞아, 미안. 다음 주 수요일까지 꼭 보낼게'라고 구체적 날짜를 약속하게 하기",
    resistancePoints: [
      '강하게 압박하면 관계가 상하고 방어적이 된다.',
      '계속 어물쩍 넘어가면 또 미뤄진다.',
      '비난조로 말하면 체면이 상해 반발한다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: '돈 얘기 꺼내기 나도 좀 그랬어. 근데 우리 사이니까 오히려 깔끔하게 정하는 게 편할 것 같아서.',
          axes: ['emotion', 'trust'],
          reason: '어색함을 함께 인정하며 관계를 존중',
        },
        {
          utterance: '부담 주려는 거 아니고, 언제쯤 가능할지만 알려주면 나도 마음 놓일 것 같아.',
          axes: ['emotion', 'logic', 'timing'],
          reason: '부담을 낮추면서 구체적 시점을 요청',
        },
      ],
      mid: [
        {
          utterance: '혹시 이번 달 안에는 어려울까? 다음 달 초라도 괜찮아.',
          axes: ['logic'],
          reason: '현실적 선택지를 제시했으나 관계 배려 표현은 약함',
        },
        {
          utterance: '천천히 줘도 되는데, 그냥 확인만 하고 싶었어.',
          axes: ['trust'],
          reason: '여유는 보였으나 요구가 흐릿함',
        },
      ],
      low: [
        {
          utterance: '야, 두 달 됐는데 아직도 안 주면 어떡해?',
          axes: ['emotion', 'trust'],
          reason: '압박·비난으로 관계·신뢰 하락',
        },
        {
          utterance: '됐어 됐어, 뭐 나중에 생각나면 줘.',
          axes: ['logic', 'timing'],
          reason: '요구 관철 실패, 또 미뤄짐을 유발',
        },
      ],
    },
    assetMap: makeAssetMap('life', 'friend'),
  },
  {
    order: 3,
    title: '여행지 의견 조율하기',
    characterName: '동행',
    characterType: '연인/친구',
    situation:
      '다가오는 연휴 여행 계획을 세우는 저녁. 당신은 조용한 바닷가에서 쉬고 싶은데, 상대는 액티비티가 많은 산·계곡을 원한다. 서로 양보할 기색 없이 각자 검색한 곳을 보여주며 은근한 신경전이 시작된다.',
    introDialogue: '난 이번엔 좀 활발하게 놀고 싶은데. 맨날 가만히 쉬기만 하면 아깝잖아. 계곡 가서 뭐라도 하자.',
    situationBrief:
      "집. 함께 여행 갈 사람과 목적지가 엇갈린다. 서로 원하는 곳이 달라 조율이 필요하다.",
    goalBrief: "상대가 \"그래, 그럼 그렇게 하자\"며 절충안에 진심으로 만족하게 하자.",
    persuasionTip:
      "이기는 게 목적이 아니라 둘 다 만족하는 게 목적이다. 내 주장을 밀기 전에 상대가 왜 그곳을 원하는지 먼저 들어주자. 상대의 니즈를 반영한 절충안이 진짜 동의를 만든다.",
    surfaceNeed: '활동적인 곳(산·계곡)에 가고 싶다',
    hiddenNeed: "이번 여행에서 '함께 뭔가 한 추억'을 만들고 싶음, 늘 상대 위주로 정해진 것에 대한 서운함",
    hiddenNeedClue: '사실 어디든 상관없는데… 매번 네가 쉬자고 해서 따라간 것 같아서. 이번엔 같이 신나게 뭐 하고 싶었어.',
    persuasionGoal: "'그래, 그럼 그렇게 하자'라며 절충안에 진심으로 만족하게 하기",
    resistancePoints: [
      "내 취향만 밀면 '또 너 위주네'로 서운함이 폭발한다.",
      '무조건 양보하면 상대의 진짜 니즈를 못 맞춘다.',
      '상대 취향을 폄하하면 감정이 상한다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: "혹시 장소보다 '같이 뭐 하는 것' 자체가 중요한 거야? 그럼 바다에서도 서핑이나 액티비티 넣으면 어때?",
          axes: ['emotion', 'logic'],
          reason: '진짜 니즈를 파악하고 절충안을 제시',
        },
        {
          utterance: '그동안 내 쪽으로 많이 맞춰준 거 알아. 이번엔 네가 하고 싶은 활동 먼저 정하고, 숙소만 조용한 데로 하자.',
          axes: ['emotion', 'trust', 'logic'],
          reason: '서운함을 인정하고 양보하며 절충안 제안',
        },
        {
          utterance: '지금 바로 정하지 말고, 각자 진짜 원하는 게 뭔지 하루만 생각해보고 내일 얘기할까?',
          axes: ['timing', 'emotion'],
          reason: '감정이 팽팽한 순간을 피해 냉각 시간을 제안',
        },
      ],
      mid: [
        {
          utterance: '그럼 첫날은 계곡, 둘째 날은 바다 이렇게 나누는 건 어때?',
          axes: ['logic'],
          reason: '절충안이나 상대 속마음엔 미접근',
        },
        {
          utterance: '나도 활동적인 거 좋아하는데, 이번엔 좀 피곤해서 쉬고 싶었어.',
          axes: ['emotion'],
          reason: '자기 감정은 표현했으나 상대 니즈 무시',
        },
      ],
      low: [
        {
          utterance: '여행 가서까지 힘 빼면서 돌아다니는 게 뭐가 좋아?',
          axes: ['emotion', 'trust'],
          reason: '상대 취향을 폄하해 감정을 상하게 함',
        },
        {
          utterance: '그냥 네가 정해, 난 아무거나 상관없어.',
          axes: ['logic', 'emotion'],
          reason: '회피로 조율에 실패',
        },
        {
          utterance: '지금 당장 정해, 이러다 예약 다 놓친다니까?',
          axes: ['timing', 'trust'],
          reason: '서운함이 올라온 상태에서 압박해 갈등을 키움',
        },
      ],
    },
    assetMap: makeAssetMap('life', 'partner'),
  },
  {
    order: 4,
    title: '중고 거래 가격 흥정하기',
    characterName: '판매자',
    characterType: '판매자',
    situation:
      '중고 거래 약속 장소. 사려는 물건(자전거)은 상태가 괜찮지만, 올라온 가격이 시세보다 조금 높다. 판매자는 이미 다른 문의도 있다는 듯 여유로운 표정이다. 무리한 요구는 하기 싫지만, 합리적인 선에서 깎고 싶다.',
    introDialogue: '직접 보시면 알겠지만 상태 정말 좋아요. 이 가격도 사실 싸게 내놓은 거예요. 문의도 여러 개 왔고요.',
    situationBrief:
      "야외 거리, 중고거래 현장. 마음에 드는 물건이 있지만 가격을 조금 깎고 싶다. 판매자는 제값을 받고 싶어 한다.",
    goalBrief: "판매자가 \"현금이면 그 가격에 드릴게요\"라며 흥정을 받아들이게 하자.",
    persuasionTip:
      "무작정 깎아달라 하면 반감을 산다. 상대에게도 이득이 되는 조건(즉시 현금, 바로 거래 등)을 제시하며, 예의 있는 타이밍과 근거로 협상하자. 깎는 게 아니라 '서로 좋은 거래'를 만드는 것.",
    surfaceNeed: '정가(제시 가격)를 받고 싶다',
    hiddenNeed: '밑지긴 싫지만 빨리·확실하게 팔고 싶음, 진상 손님은 피하고 싶음',
    hiddenNeedClue: '뭐 아예 안 되는 건 아닌데… 괜히 깎아놓고 안 사가는 분들이 많아서 좀 그래요.',
    persuasionGoal: "'현금이면 그 가격에 드릴게요'라고 흥정을 받아들이게 하기",
    resistancePoints: [
      '무작정 반값을 부르면 진상으로 취급받고 거래가 무산된다.',
      '근거 없이 깎아달라고만 하면 통하지 않는다.',
      '물건을 폄하하면 판매자가 방어적이 된다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: '상태 좋은 거 인정해요. 같은 모델 다른 매물들이 대체로 이 정도라, 그 선에 맞춰주시면 오늘 바로 현금으로 가져갈게요.',
          axes: ['logic', 'trust'],
          reason: '시세 근거와 확실한 구매 의사를 결합',
        },
        {
          utterance: '괜히 깎고 안 사가는 분들 때문에 신경 쓰이시죠? 저는 지금 바로 결제할 수 있어요.',
          axes: ['emotion', 'timing'],
          reason: '판매자 우려를 읽고 확실한 거래로 안심시킴',
        },
      ],
      mid: [
        {
          utterance: '만원만 깎아주시면 안 될까요? 딱 그 정도면 저도 바로 살게요.',
          axes: ['logic'],
          reason: '작은 요구와 의사 표현은 있으나 근거가 약함',
        },
        {
          utterance: '혹시 조금 조정 가능하실까요?',
          axes: ['trust'],
          reason: '정중하나 근거·의사 표현이 부족',
        },
      ],
      low: [
        {
          utterance: '이거 이 가격은 너무 비싸요, 반값도 안 하겠는데?',
          axes: ['logic', 'trust'],
          reason: '근거 없는 폄하로 신뢰 붕괴',
        },
        {
          utterance: '다른 데는 더 싸던데 그냥 여기서 살게요, 깎아주세요.',
          axes: ['logic', 'emotion'],
          reason: '모순된 압박으로 설득력 없음',
        },
      ],
    },
    assetMap: makeAssetMap('life', 'seller'),
  },
  {
    order: 5,
    title: '룸메이트에게 불편함 정중히 말하기',
    characterName: '룸메이트',
    characterType: '룸메이트',
    situation:
      '같이 사는 룸메이트. 최근 밤늦게까지 통화하거나 음악을 크게 트는 일이 잦아 잠을 설쳤다. 좋은 사이를 유지하고 싶어 참아왔지만 계속되니 말해야 한다. 저녁, 거실에서 마주친 지금이 기회다. 상대는 별생각 없이 편안해 보인다.',
    introDialogue: '어, 왔어? 오늘 하루 어땠어?',
    situationBrief:
      "공유 생활공간. 룸메이트의 소음 때문에 불편하지만, 매일 같이 사는 사이라 관계가 틀어지면 곤란하다.",
    goalBrief: "룸메이트가 \"아 그런 거였구나, 미안. 앞으로 조심할게\"라고 흔쾌히 수용하게 하자.",
    persuasionTip:
      "비난은 방어를 부른다. 상대를 탓하기보다 '내가 어떻게 불편했는지'를 차분히 전하자. 감정을 상하지 않게 하는 신뢰와 타이밍이, 같이 사는 사이에선 특히 중요하다.",
    surfaceNeed: "특별히 문제를 못 느낌 ('그렇게까지 시끄러웠나?')",
    hiddenNeed: '비난받는다는 느낌 없이 존중받고 싶음, 좋은 관계가 상하지 않길 바람',
    hiddenNeedClue: '어… 나 그렇게 시끄러웠어? 몰랐네. 근데 갑자기 그렇게 말하니까 좀 당황스럽다.',
    persuasionGoal: "'아 그런 거였구나, 미안. 앞으로 방에서 할게'라고 흔쾌히 수용하게 하기",
    resistancePoints: [
      '대뜸 비난하면 방어적이 되고 관계가 상한다.',
      '너무 돌려 말하면 문제가 전달되지 않는다.',
      '감정이 상하면 요구 자체를 거부한다.',
    ],
    scoringExamples: {
      high: [
        {
          utterance: '네 잘못이라기보다, 내가 요즘 잠귀가 예민해져서 그래. 혹시 11시 이후엔 통화 좀 방에서 해줄 수 있을까?',
          axes: ['emotion', 'trust', 'logic'],
          reason: '비난을 피하고 관계를 존중하며 구체적 요청',
        },
        {
          utterance: '지금 편하게 얘기하고 싶어서 꺼내는 거야. 사이 안 좋아지려는 게 절대 아니고.',
          axes: ['emotion', 'timing', 'trust'],
          reason: '의도를 먼저 밝혀 방어를 낮추고 관계를 지킴',
        },
      ],
      mid: [
        {
          utterance: '밤에 소리가 좀 들려서, 조금만 줄여주면 고마울 것 같아.',
          axes: ['logic'],
          reason: '요청은 명확하나 상대 감정 배려가 약함',
        },
        {
          utterance: '우리 서로 배려하면서 지내면 좋잖아, 그치?',
          axes: ['trust'],
          reason: '관계는 챙겼으나 요구가 흐릿함',
        },
      ],
      low: [
        {
          utterance: '너 요즘 진짜 너무 시끄러운 거 알아? 매일 잠을 못 자잖아.',
          axes: ['emotion', 'trust'],
          reason: '비난으로 감정·신뢰 붕괴',
        },
        {
          utterance: '아니야 됐어, 그냥 내가 참을게.',
          axes: ['logic', 'timing'],
          reason: '회피·수동공격으로 요구 전달에 실패',
        },
      ],
    },
    assetMap: makeAssetMap('life', 'roommate'),
  },
];

/** 시나리오 배열 → seed가 쓰는 { id, data } 형태로 변환 (문서 id는 order 기준) */
const toStageDocs = (scenarios) =>
  scenarios.map((s) => ({ id: `stage${s.order}`, data: { ...s } }));

/** 트랙별 스테이지 — seed 스크립트와 테스트가 이 형태로 소비한다. */
const STAGES_BY_TRACK = {
  work: toStageDocs(WORK_SCENARIOS),
  life: toStageDocs(LIFE_SCENARIOS),
};

/** 트랙별 settings — 현재는 두 트랙 모두 기본값을 쓴다. */
const SETTINGS_BY_TRACK = {
  work: { ...DEFAULT_SETTINGS },
  life: { ...DEFAULT_SETTINGS },
};

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_BY_TRACK,
  STAGES_BY_TRACK,
  TRACK_META,
  SCORING_AXES,
  makeAssetMap,
  // 하위 호환 — seed.js(데모 룸)는 업무 트랙을 그대로 쓴다
  STAGES: STAGES_BY_TRACK.work,
};
