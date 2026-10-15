/**
 * 설득 게임 자동 플레이 시뮬레이션.
 *
 * 학습자 역을 Gemini에게 맡겨 끝까지 돌려본다.
 * 중요한 규칙: 학습자 역에게는 **브리핑에 보이는 정보만** 준다.
 *   숨은 니즈·여는 열쇠·채점 예시는 절대 주지 않는다. 실제 학습자와 같은 조건으로 두기 위해서다.
 *
 * 숙련도 3단계로 돌려 난이도 곡선이 의도대로 갈리는지 본다.
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const API = 'http://127.0.0.1:8788/api/score';

// .dev.vars에서 키를 읽는다 (화면에는 절대 찍지 않는다)
const devVars = readFileSync('.dev.vars', 'utf8');
const KEY = devVars.match(/^GEMINI_API_KEY\s*=\s*"?([^"\n\r]+)"?/m)?.[1]?.trim();
if (!KEY) throw new Error('.dev.vars에서 GEMINI_API_KEY를 찾지 못했습니다');

const stageData = createRequire(import.meta.url)('./scripts/stageData.js');

const SKILLS = {
  능숙: `당신은 설득에 능숙한 사람이다. 상대의 말 뒤에 있는 진짜 이유를 궁금해하고,
섣불리 해결책을 던지기보다 먼저 묻고 들어준다. 필요할 때는 구체적인 근거와 실행 계획을 내놓는다.
다만 당신은 상대의 속마음을 미리 알지 못한다 — 대화에서 단서를 찾아 추측해야 한다.`,
  보통: `당신은 평범한 직장인이다. 선의는 있지만 설득 기술을 따로 배운 적은 없다.
상대가 거절하면 이유를 설명하거나 설득하려 들고, 가끔은 조급해져서 결론을 재촉한다.
감정을 읽어주기보다 해결책을 먼저 말하는 편이다.`,
  서툼: `당신은 설득이 서툰 사람이다. 상대의 감정보다 내 용건이 급하다.
같은 말을 반복하거나, 답답해지면 다그치고, 상대가 왜 그러는지는 깊이 생각하지 않는다.
단 욕설이나 폭언은 하지 않는다 — 그저 서툴 뿐이다.`,
};

async function learnerSays(stage, skill, history, turn, maxTurns) {
  const convo = history.length
    ? history.map((m) => `${m.role === 'user' ? '나' : stage.characterName}: ${m.text}`).join('\n')
    : '(아직 대화 전)';

  // 브리핑에서 학습자가 실제로 보는 것만 전달한다
  const prompt = `${SKILLS[skill]}

당신은 지금 아래 상황에 놓여 있다. 상대를 설득해야 한다.

## 상황
${stage.situationBrief || stage.situation}

## 내 목표
${stage.goalBrief || stage.persuasionGoal}

## 참고 조언
${stage.persuasionTip || '(없음)'}

## 지금까지의 대화
${convo}

## 지시
지금 당신이 할 말 한 마디를 쓰십시오. (${turn}번째 발화 / 최대 ${maxTurns}번)
- 한국어 구어체로 1~3문장.
- 실제로 입 밖에 낼 말만 쓸 것. 설명·따옴표·지문은 넣지 말 것.
- 위 숙련도 설정에 충실하게 행동할 것.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9 },
      }),
    }
  );
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('학습자 발화 생성 실패: ' + JSON.stringify(j).slice(0, 300));
  return text.replace(/^["'"]|["'"]$/g, '').split('\n')[0].trim();
}

async function simulate(track, stageId, skill) {
  const stage = stageData.STAGES_BY_TRACK[track].find((s) => s.id === stageId).data;
  const diff = stage.difficulty;
  const maxTurns = diff.maxMessages;

  console.log(`\n${'█'.repeat(76)}`);
  console.log(`█ ${stage.title} — ${stage.characterName}  |  Lv${diff.level}  |  학습자: ${skill}`);
  console.log(`█ ${diff.startGauge} → 성공선 ${diff.successLine} · 최대 ${maxTurns}발화`);
  console.log(`${'█'.repeat(76)}`);
  console.log(`\n${stage.characterName}: "${stage.introDialogue}"`);

  let gauge = diff.startGauge;
  let peak = gauge;
  const history = [];
  let lastLayer = 0;
  let succeededAt = null;
  let lowTurns = 0;
  let stallTurns = 0;
  let brokeAt = null;
  const deltas = [];

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const msg = await learnerSays(stage, skill, history, turn, maxTurns);

    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode: 'DEMO01', track, stageId,
        currentGauge: gauge, conversationHistory: history, userMessage: msg, turnIndex: turn, stallTurns,
      }),
    });
    const r = await res.json();
    if (!res.ok) { console.log('  채점 실패:', r.error); break; }

    const d = r.scoreDelta >= 0 ? `+${r.scoreDelta}` : `${r.scoreDelta}`;
    deltas.push(r.scoreDelta);
    const clue = r.revealedLayer > lastLayer ? `  🔍단서${r.revealedLayer}` : '';
    lastLayer = Math.max(lastLayer, r.revealedLayer);

    console.log(`\n[${String(turn).padStart(2)}] 나: "${msg}"`);
    console.log(`     ${String(gauge).padStart(3)} → ${String(r.newGauge).padStart(3)} (${d})${clue}`);
    console.log(`     ${stage.characterName}: "${r.characterReply}"`);

    history.push({ role: 'user', text: msg });
    history.push({ role: 'character', text: r.characterReply });
    if (r.newGauge > peak) stallTurns = 0; else stallTurns += 1;
    gauge = r.newGauge;
    peak = Math.max(peak, gauge);

    if (succeededAt === null && gauge >= diff.successLine) {
      succeededAt = turn;
      console.log(`     🎉 성공선 ${diff.successLine} 도달 (${turn}번째 발화)`);
      break; // 학습자가 "여기서 마무리"를 누른 것으로 본다
    }

    // 결렬 판정 — 플레이 화면과 같은 규칙 (결렬선 이하 두 턴)
    if (gauge <= diff.breakdownLine) {
      lowTurns += 1;
      if (lowTurns === 1) console.log(`     ⚠ 결렬 경고 (게이지 ${gauge} ≤ 결렬선 ${diff.breakdownLine})`);
      else {
        console.log(`     💔 대화 결렬 — 상대가 마음을 닫았습니다`);
        brokeAt = turn;
        break;
      }
    } else lowTurns = 0;
  }

  const avg = deltas.length ? (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1) : '0';
  console.log(`\n  ── 결과: ${succeededAt ? `성공 (${succeededAt}턴)` : '실패'} · 점수(최고점) ${peak} · 평균 ${avg}/턴 · 단서 ${lastLayer}/3`);
  return { succeededAt, brokeAt, peak, turns: deltas.length, avg, layer: lastLayer };
}

const plan = JSON.parse(process.argv[2]);
const results = [];
for (const p of plan) results.push({ ...p, ...(await simulate(p.track, p.stage, p.skill)) });

console.log(`\n\n${'='.repeat(76)}\n요약\n${'='.repeat(76)}`);
for (const r of results) {
  console.log(
    `  ${r.stage} ${String(r.skill).padEnd(3)} | ${r.succeededAt ? `성공 ${String(r.succeededAt).padStart(2)}턴` : (r.brokeAt ? `결렬 ${String(r.brokeAt).padStart(2)}턴` : `미달 ${String(r.turns).padStart(2)}턴`)} | 점수 ${String(r.peak).padStart(3)} | 평균 ${String(r.avg).padStart(5)}/턴 | 단서 ${r.layer}/3`
  );
}
