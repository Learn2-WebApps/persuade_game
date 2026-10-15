/**
 * playScreen.js — 대화 화면(플레이 화면) · 비주얼노벨 레이아웃
 *
 * 흐름:
 *   진입 → Firestore에서 스테이지/설정 로드 (실패 시 내장 데모 데이터 폴백)
 *        → introDialogue 표시, 게이지 50, 타이머 시작
 *   전송 → POST /api/score → 게이지·감정·대사 갱신, 대화 기록 누적
 *   종료 → 타이머 0 / "대화 마치기" / 메시지 한도 도달 → 결과 오버레이
 *
 * 화면 구성 (게임 로직은 그대로, 표현만 비주얼노벨식):
 *   배경(전체 화면) → 캐릭터(중앙 하단, 감정별 이미지 크로스페이드)
 *   → 좌상단 챕터 pill / 우상단 EP 노드·게이지·타이머 → 하단 대사창(타이핑 효과) → 입력 바
 *
 * 에셋 경로 규칙은 ./assets.js 참고. 이미지가 없으면 플레이스홀더로 자동 폴백한다.
 */

import './playScreen.css';
import { isFirebaseConfigured, fetchRoom, fetchStage } from '../common/firebase.js';
import { DEMO_SETTINGS, DEMO_STAGE1 } from './demoStage.js';
import { resolveBackground, resolveCharacter, preloadStageAssets } from './assets.js';
import { isVoiceInputSupported, createVoiceInput } from './voiceInput.js';
import { readDifficulty, emotionFor, levelLabel } from '../common/difficulty.js';

// 시작 게이지·성공선은 더 이상 고정값이 아니다 — 스테이지 난이도에서 읽는다.
// (아래 GAUGE_START는 스테이지 로드 전 초기값일 뿐이며, 로드 직후 난이도 값으로 덮인다)
const GAUGE_START = 50;
const TYPING_SPEED_MS = 22; // 대사 타이핑 속도 (글자당)

const EMOTION_META = {
  very_happy: { emoji: '🥰', label: 'VERY HAPPY' },
  happy: { emoji: '😊', label: 'HAPPY' },
  normal: { emoji: '🙂', label: 'NORMAL' },
  worry: { emoji: '😟', label: 'WORRY' },
  angry: { emoji: '😠', label: 'ANGRY' },
};

// 게이지 색 구간은 감정 구간(difficulty.js emotionFor)과 경계를 맞춘다.
// 성공선이 스테이지마다 다르므로 색 경계도 성공선 기준으로 함께 움직인다.
const gaugeClass = (g, successLine = 85) =>
  g >= successLine
    ? 'g-very-happy'
    : g >= successLine - 15
      ? 'g-happy'
      : g >= successLine - 35
        ? 'g-normal'
        : g >= successLine - 55
          ? 'g-worry'
          : 'g-angry';
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {object}   opts
 * @param {string}   opts.roomCode
 * @param {string}   opts.track    - 'work' | 'life' (스테이지를 어느 트랙에서 읽을지)
 * @param {string}   opts.stageId
 * @param {number}   [opts.totalStages] - 우상단 EP 노드 개수 (표시용, 기본 5)
 * @param {Function} [opts.onEnd]  - 종료 시 호출: async (finalScore, turns) => {} (점수 + 대화 로그 저장용)
 *                                   { exitLabel }을 반환하면 종료 버튼 문구를 그 값으로 바꾼다.
 * @param {Function} [opts.onExit] - 결과 화면의 종료 버튼 클릭 시 호출. 없으면 새로고침(다시 하기).
 */
export async function initPlayScreen({ roomCode, track, stageId, totalStages = 5, onEnd, onExit }) {
  const state = {
    roomCode,
    track,
    stageId,
    stage: null,
    settings: { ...DEMO_SETTINGS },
    gauge: GAUGE_START,
    // 스테이지 로드 직후 난이도 값으로 채워진다 (1-1 단계)
    difficulty: null,
    // 최고점 — 최종 점수는 이 값으로 매긴다.
    // (예전에는 "마지막 게이지"가 점수라, 95까지 올려놓고 끝에 실언하면 70으로 끝났다.
    //  설득이 통했던 순간이 있었다는 사실 자체를 성과로 인정하는 게 교육적으로 맞다)
    peakGauge: GAUGE_START,
    // 상대의 숨은 의도를 몇 겹까지 벗겼는지 (0 = 겉으로 하는 말만 들은 상태)
    revealedLayer: 0,
    // 결렬선 아래에 머문 턴 수. 두 턴이 쌓이면 대화가 결렬되어 스테이지가 끝난다.
    // (게이지 0을 찍고도 계속 다그치는 무의미한 구간을 없애기 위함)
    lowTurns: 0,
    // 의미 있는 진전 없이 흘러간 턴 수. 4턴이 넘으면 상대가 더 분명한 신호를 준다.
    // (결렬도 성공도 아닌 채 제자리를 맴도는 구간을 없애기 위함)
    stallTurns: 0,
    emotion: 'normal',
    history: [], // [{ role: 'user' | 'character', text }]
    feedbackLog: [], // feedback은 화면에 표시하지 않고 내부 저장만 한다
    // 턴별 대화 로그 — 스테이지 종료 시 stageResults.turns 로 저장되어 최종 리포트의 인용 근거가 된다
    turns: [], // [{ userMessage, scoreDelta, gaugeAfter, actionTags, characterReply, timestamp }]
    userMsgCount: 0,
    remainingSec: DEMO_SETTINGS.stageTimeLimit,
    timerId: null,
    sending: false,
    ended: false,
    fallbackNotice: '',
    // 마이크로 말한 직후의 오디오 — 전송 시 채점 요청에 함께 실어 어조 평가에 쓴다.
    // 타이핑으로만 입력하면 null로 남고, 어조 평가 없이 지금까지처럼 텍스트로만 채점된다.
    pendingAudio: null,
  };

  // ── 1) 스테이지 데이터 로드 (실패 시 데모 폴백) ─────────────
  if (!isFirebaseConfigured) {
    state.stage = DEMO_STAGE1;
    state.fallbackNotice = 'Firebase 웹 config 미설정 — 내장 데모 데이터로 표시 중 (채점은 정상 동작)';
  } else {
    try {
      const [room, stage] = await Promise.all([
        fetchRoom(roomCode),
        fetchStage(roomCode, track, stageId),
      ]);
      if (!stage) throw new Error(`스테이지 없음: ${roomCode}/${track}/${stageId}`);
      state.stage = stage;
      if (room?.settings) {
        state.settings = {
          stageTimeLimit: room.settings.stageTimeLimit ?? DEMO_SETTINGS.stageTimeLimit,
          maxMessagesPerStage: room.settings.maxMessagesPerStage ?? DEMO_SETTINGS.maxMessagesPerStage,
        };
      }
    } catch (err) {
      console.warn('[play] Firestore 로드 실패, 데모 데이터로 폴백:', err);
      state.stage = DEMO_STAGE1;
      state.fallbackNotice = 'Firestore 읽기 실패 — 내장 데모 데이터로 표시 중 (채점은 정상 동작)';
    }
  }
  // ── 1-1) 난이도 적용 ────────────────────────────────────────
  // 시작 게이지·성공선·제한시간·발화 수가 스테이지마다 다르다 (scripts/stageData.js의 DIFFICULTY_CURVE).
  // 난이도에 시간·발화 수가 있으면 룸 설정보다 우선한다 — EP1은 짧고 쉽게, EP5는 길고 어렵게.
  state.difficulty = readDifficulty(state.stage);
  state.gauge = state.difficulty.startGauge;
  state.peakGauge = state.gauge;
  state.emotion = emotionFor(state.gauge, state.difficulty.successLine);
  if (state.difficulty.timeLimit != null) state.settings.stageTimeLimit = state.difficulty.timeLimit;
  if (state.difficulty.maxMessages != null) {
    state.settings.maxMessagesPerStage = state.difficulty.maxMessages;
  }
  state.remainingSec = state.settings.stageTimeLimit;

  // ── 2) 렌더 ─────────────────────────────────────────────────
  const app = document.getElementById('app');
  app.innerHTML = renderHtml(state, totalStages);

  const el = {
    root: app.querySelector('.vn'),
    bg: app.querySelector('.vn-bg-image'),
    charLayers: app.querySelectorAll('.vn-char'),
    charPlaceholder: app.querySelector('.vn-char-placeholder'),
    charEmotionLabel: app.querySelector('.char-emotion-label'),
    gaugeFill: app.querySelector('.gauge-fill'),
    gaugeNum: app.querySelector('.gauge-num'),
    timer: app.querySelector('.timer'),
    dialogue: app.querySelector('.vn-dialogue'),
    bubbleText: app.querySelector('.bubble-text'),
    bubbleNext: app.querySelector('.bubble-next'),
    input: app.querySelector('.chat-input'),
    sendBtn: app.querySelector('.send-btn'),
    micBtn: app.querySelector('.mic-btn'),
    micStatus: app.querySelector('.mic-status'),
    endBtn: app.querySelector('.end-btn'),
    msgCount: app.querySelector('.msg-count'),
    errorToast: app.querySelector('.error-toast'),
    clueToast: app.querySelector('.clue-toast'),
    clueMeter: app.querySelector('.clue-meter'),
    goalBanner: app.querySelector('.goal-banner'),
    overlay: app.querySelector('.result-overlay'),
  };

  // 마이크 컨트롤러 — 아래 5-1)에서 만든다. 미지원 브라우저에서는 끝까지 null로 남는다.
  let voice = null;

  // ── 프리로딩(안전망): 보통은 브리핑 화면에서 이미 데워졌지만, 브리핑을 건너뛰었거나
  //    빠르게 START한 경우를 대비해 여기서도 5표정 + 배경을 미리 로드한다.
  //    (_requested 집합이 중복 요청을 막으므로 이중 호출이어도 네트워크 낭비가 없다.) ──
  preloadStageAssets(state.stage, track, stageId);

  // ── 배경 이미지: 있으면 표시, 없으면 그라데이션 플레이스홀더 유지 ──
  {
    const src = resolveBackground(state.stage, track, stageId);
    const probe = new Image();
    probe.onload = () => {
      el.bg.style.backgroundImage = `url("${src}")`;
      el.root.classList.add('has-bg');
    };
    probe.onerror = () => {
      // 에셋 미준비 상태 — 플레이스홀더 그라데이션을 그대로 둔다
      console.info(`[play] 배경 에셋 없음(플레이스홀더 사용): ${src}`);
    };
    probe.src = src;
  }

  // ── 3) UI 갱신 함수들 ───────────────────────────────────────
  function updateGauge() {
    const line = state.difficulty.successLine;
    el.gaugeFill.style.width = `${state.gauge}%`;
    el.gaugeFill.className = `gauge-fill ${gaugeClass(state.gauge, line)}`;
    el.gaugeNum.textContent = state.gauge;
    // 성공선을 넘긴 순간부터 게이지에 표식을 남긴다 (다시 내려가도 "닿았었다"가 보이게)
    el.root.classList.toggle('reached-goal', state.peakGauge >= line);
  }

  /**
   * 감정이 바뀌면 캐릭터 이미지를 크로스페이드한다.
   * 감정 구간 판정(very_happy/happy/normal/worry/angry 5단계)은 서버 게이지 로직 그대로 쓰고, 여기선 표시만 한다.
   * 이미지가 없으면 플레이스홀더 실루엣을 감정 색으로 바꿔 전환이 보이게 한다.
   */
  let activeCharLayer = 0;
  function updateEmotion() {
    const meta = EMOTION_META[state.emotion] || EMOTION_META.normal;
    el.charEmotionLabel.textContent = meta.label;
    // 플레이스홀더(이미지 없을 때)도 감정에 따라 색·표정이 바뀌도록
    el.charPlaceholder.dataset.emotion = state.emotion;
    el.charPlaceholder.querySelector('.vn-char-face').textContent = meta.emoji;
    el.root.className = `vn emotion-${state.emotion}${el.root.classList.contains('has-bg') ? ' has-bg' : ''}`;

    const src = resolveCharacter(state.stage, track, state.emotion);
    if (!src) return;

    const probe = new Image();
    probe.onload = () => {
      // 비어 있는 쪽 레이어에 새 이미지를 올리고 서로 페이드
      const next = (activeCharLayer + 1) % 2;
      el.charLayers[next].src = src;
      el.charLayers[next].classList.add('show');
      el.charLayers[activeCharLayer].classList.remove('show');
      activeCharLayer = next;
      el.root.classList.add('has-char');
    };
    probe.onerror = () => {
      console.info(`[play] 캐릭터 에셋 없음(플레이스홀더 사용): ${src}`);
    };
    probe.src = src;
  }

  function updateTimer() {
    const m = Math.floor(state.remainingSec / 60);
    const s = state.remainingSec % 60;
    el.timer.textContent = `${pad2(m)}:${pad2(s)}`;
    el.timer.classList.toggle('timer-warn', state.remainingSec <= 30);
  }

  function updateMsgCount() {
    el.msgCount.textContent = `${state.userMsgCount} / ${state.settings.maxMessagesPerStage}`;
  }

  // ── 대사 타이핑 효과 ────────────────────────────────────────
  let typingTimer = null;
  let typingFullText = '';

  /** 타이핑을 즉시 완성 (대사창 클릭·스킵) */
  function finishTyping() {
    if (!typingTimer) return;
    clearInterval(typingTimer);
    typingTimer = null;
    el.bubbleText.textContent = typingFullText;
    el.dialogue.classList.remove('typing');
  }

  function setBubble(text, thinking = false) {
    clearInterval(typingTimer);
    typingTimer = null;
    el.bubbleText.classList.toggle('thinking', thinking);

    // "생각 중"은 타이핑 없이 바로 표시 (로딩 상태라 연출이 방해된다)
    if (thinking) {
      el.dialogue.classList.remove('typing');
      el.bubbleText.textContent = text;
      return;
    }

    typingFullText = String(text ?? '');
    el.bubbleText.textContent = '';
    el.dialogue.classList.add('typing');

    let i = 0;
    typingTimer = setInterval(() => {
      i += 1;
      el.bubbleText.textContent = typingFullText.slice(0, i);
      if (i >= typingFullText.length) finishTyping();
    }, TYPING_SPEED_MS);
  }

  function setSending(sending) {
    state.sending = sending;
    el.sendBtn.disabled = sending || state.ended;
    el.input.disabled = sending || state.ended;
    el.micBtn.disabled = sending || state.ended;
    el.sendBtn.classList.toggle('loading', sending);
  }

  /**
   * 성공선 도달 연출 — 짧은 배너 + "여기서 마무리하기" 버튼.
   * 배너는 몇 초 뒤 사라지고, 학습자는 계속 대화하거나 바로 끝낼 수 있다.
   */
  function showGoalReached() {
    el.goalBanner.innerHTML = `
      <div class="goal-inner">
        <span class="goal-spark" aria-hidden="true">✦</span>
        <div class="goal-text">
          <strong>마음이 열렸어요!</strong>
          <span>${escapeHtml(state.stage.characterName)} 님이 받아들이기 시작했어요. 여기서 마무리해도 좋아요.</span>
        </div>
        <button class="goal-finish" type="button">여기서 마무리</button>
      </div>`;
    el.goalBanner.classList.add('show');
    el.goalBanner
      .querySelector('.goal-finish')
      .addEventListener('click', () => endStage('설득 성공 — 학습자가 마무리'));
    setTimeout(() => el.goalBanner.classList.remove('show'), 7000);
  }

  /**
   * 숨은 의도 단계가 올라간 순간 — "한 겹 벗겨졌다"를 알린다.
   * 단서 내용 자체는 캐릭터 대사로 흘러나오므로, 여기서는 알아냈다는 사실만 짚어준다.
   * (내용까지 적어주면 대사를 안 읽고 이것만 보게 된다)
   */
  function showClueGained(layer, total) {
    el.clueToast.innerHTML = `
      <span class="clue-icon" aria-hidden="true">🔍</span>
      <span class="clue-text">
        <strong>${escapeHtml(state.stage.characterName)} 님의 속내가 한 겹 보였어요</strong>
        <span>방금 대사에 단서가 숨어 있어요 · ${layer} / ${total - 1}단계</span>
      </span>`;
    el.clueToast.classList.add('show');
    clearTimeout(clueTimer);
    clueTimer = setTimeout(() => el.clueToast.classList.remove('show'), 5000);

    // HUD의 단서 표시도 갱신
    el.clueMeter.hidden = false;
    el.clueMeter.textContent = `🔍 단서 ${layer}/${total - 1}`;
    el.clueMeter.classList.add('bump');
    setTimeout(() => el.clueMeter.classList.remove('bump'), 700);
  }

  let clueTimer = null;
  let toastTimer = null;
  function showError(message) {
    el.errorToast.textContent = message;
    el.errorToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.errorToast.classList.remove('show'), 4000);
  }

  // ── 4) 종료 처리 ────────────────────────────────────────────
  async function endStage(reason) {
    if (state.ended) return;
    state.ended = true;
    clearInterval(state.timerId);
    finishTyping(); // 타이핑 중이었다면 완성해두고 종료
    voice?.cancel(); // 마이크가 켜져 있었다면 즉시 끈다 (녹음 중 화면이 넘어가는 것 방지)
    el.input.disabled = true;
    el.sendBtn.disabled = true;
    el.micBtn.disabled = true;
    el.micStatus.textContent = '';
    el.endBtn.disabled = true;
    el.goalBanner.classList.remove('show');

    // 점수는 "마지막 게이지"가 아니라 "최고점"이다 — 설득이 통했던 순간을 성과로 인정한다.
    const line = state.difficulty.successLine;
    const score = state.peakGauge;
    const success = score >= line;
    // 최고점에서 내려온 폭 — 마무리에서 흐트러졌다면 디브리핑 거리가 된다
    const dropped = state.peakGauge - state.gauge;
    el.overlay.innerHTML = `
      <div class="result-card ${success ? 'success' : ''}">
        ${
          success
            ? `<div class="result-sparkles" aria-hidden="true"><span>✦</span><span>✦</span><span>✧</span><span>⭐</span><span>✦</span><span>✧</span></div>`
            : ''
        }
        <div class="result-stage">STAGE ${state.stage.order} 종료 · Lv${state.difficulty.level} ${levelLabel(state.difficulty.level)}</div>
        <div class="result-score">설득 점수 <strong>${score}</strong></div>
        ${
          dropped >= 8
            ? `<div class="result-note">최고 ${state.peakGauge}까지 올랐다가 ${state.gauge}로 내려왔어요. 점수는 최고점으로 계산했지만, 마무리에서 무엇이 어긋났는지 리포트에서 확인해 보세요.</div>`
            : ''
        }
        <div class="result-badge ${success ? 'ok' : 'ng'}">
          ${success ? '🎉 설득 성공!' : `아쉬워요 (성공 기준 ${line})`}
        </div>
        <div class="result-reason">${reason}</div>
        <div class="save-status"></div>
        <button class="retry-btn" type="button" disabled>${onExit ? '스테이지 맵으로' : '다시 하기'}</button>
      </div>`;
    el.overlay.classList.add('show');

    const saveEl = el.overlay.querySelector('.save-status');
    const btn = el.overlay.querySelector('.retry-btn');

    // 최종 게이지를 점수로 확정하고 대화 로그와 함께 저장 (onEnd가 없으면 저장 없이 바로 진행)
    if (onEnd) {
      saveEl.textContent = '점수 저장 중…';
      try {
        // onEnd가 { exitLabel }을 돌려주면 종료 버튼 문구를 바꾼다
        // (예: 트랙의 마지막 스테이지 → 맵이 아니라 설득 리포트로 이어짐)
        const info = await onEnd(score, state.turns, {
          finalGauge: state.gauge,
          peakGauge: state.peakGauge,
          successLine: line,
          succeeded: success,
          difficultyLevel: state.difficulty.level,
        });
        if (info?.exitLabel) btn.textContent = info.exitLabel;
        saveEl.textContent = '✅ 점수가 저장되었어요';
      } catch (err) {
        console.error('[play] 점수 저장 실패:', err);
        saveEl.textContent = '⚠ 점수 저장에 실패했어요 (네트워크 확인 후 스테이지를 다시 플레이해 주세요)';
      }
    }

    btn.disabled = false;
    btn.addEventListener('click', () => (onExit ? onExit() : location.reload()));
  }

  // ── 5) 전송 처리 ────────────────────────────────────────────
  async function sendMessage() {
    // 마이크가 켜진 채로 SEND를 누른 경우: 먼저 멈춰서 최종 텍스트·오디오를 확정한 뒤 다시 진행한다
    if (voice?.isListening()) {
      await voice.stop();
      return sendMessage();
    }

    const text = el.input.value.trim();
    if (!text || state.sending || state.ended) return;

    // 이번 발화의 오디오 — 성공하든 실패하든 이 턴에서만 쓰고 비운다
    const audio = state.pendingAudio;
    state.pendingAudio = null;

    setSending(true);
    setBubble('생각 중', true);

    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: state.roomCode,
          track: state.track,
          stageId: state.stageId,
          currentGauge: state.gauge,
          // 몇 번째 발화인지 — 서버가 "설계된 궤도 대비 얼마나 빠른가"를 보고 채점 강도를 조절한다
          turnIndex: state.userMsgCount + 1,
          // 제자리걸음이 길어지면 상대가 더 분명한 신호를 주도록 서버에 알린다
          stallTurns: state.stallTurns,
          conversationHistory: state.history,
          userMessage: text,
          // 마이크로 말했을 때만 실린다. 서버는 이 오디오로 "어조"만 따로 평가하고,
          // 4축 점수·게이지는 지금까지처럼 텍스트만 보고 매긴다 (채점 기준 불변).
          audio,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `채점 요청 실패 (${res.status})`);
      }
      const data = await res.json();

      // 상태 반영
      state.history.push({ role: 'user', text });
      state.history.push({ role: 'character', text: data.characterReply });
      state.feedbackLog.push({ userMessage: text, ...data, at: Date.now() });
      // 리포트 인용용 턴 로그 누적 (Firestore가 undefined를 거부하므로 기본값으로 방어)
      state.turns.push({
        userMessage: text,
        scoreDelta: Number(data.scoreDelta) || 0,
        gaugeAfter: Number(data.newGauge) || state.gauge,
        // 4축 점수 — 리포트가 "무엇이 통했는지"를 풀어서 설명하는 근거로 쓴다
        axisScores: {
          emotion: Number(data.axisScores?.emotion) || 0,
          logic: Number(data.axisScores?.logic) || 0,
          trust: Number(data.axisScores?.trust) || 0,
          timing: Number(data.axisScores?.timing) || 0,
        },
        actionTags: Array.isArray(data.actionTags) ? data.actionTags : [],
        // 어조 평가 — 마이크로 말한 턴에만 들어온다(타이핑 턴은 null).
        // 점수에는 반영하지 않고, 최종 리포트의 "전달력" 코칭에만 쓴다.
        tone: data.tone || null,
        characterReply: data.characterReply || '',
        timestamp: Date.now(),
      });
      state.userMsgCount += 1;
      state.gauge = data.newGauge;
      state.emotion = data.newEmotion;

      // 성공선을 처음 넘긴 순간 — 설득이 통했다는 걸 분명히 보여준다.
      // (예전에는 넘겨도 아무 일이 없어서, 이긴 줄도 모르고 남은 턴을 계속 떠들었다)
      const line = state.difficulty.successLine;
      const justReached = state.peakGauge < line && state.gauge >= line;

      // 최고점을 갱신했으면 진전으로 보고 정체 카운터를 리셋한다.
      // 올랐다 내렸다만 반복하는 것은 진전이 아니다 — 최고점 갱신만 진전으로 친다.
      if (state.gauge > state.peakGauge) state.stallTurns = 0;
      else state.stallTurns += 1;

      state.peakGauge = Math.max(state.peakGauge, state.gauge);

      // 숨은 의도가 한 겹 더 벗겨졌는가 (단계가 있는 시나리오에서만)
      const layer = Number(data.revealedLayer) || 0;
      const layerCount = Number(data.hiddenNeedLayerCount) || 0;
      if (layerCount > 1 && layer > state.revealedLayer) {
        state.revealedLayer = layer;
        showClueGained(layer, layerCount);
      }

      // 화면 반영
      updateGauge();
      updateEmotion();
      updateMsgCount();
      setBubble(data.characterReply);
      el.input.value = '';
      setSending(false);
      el.input.focus();

      // 설득이 통한 순간 — 연출을 띄우고 "여기서 마무리" 선택지를 준다.
      // 자동 종료하지 않는 이유: 마음이 열린 뒤 어떻게 마무리하는지도 설득의 일부라서,
      // 더 대화할지 끝낼지는 학습자가 고르게 둔다. (점수는 이미 최고점으로 확보돼 있다)
      if (justReached) showGoalReached();

      // ── 대화 결렬 판정 ──
      // 게이지가 결렬선 아래로 내려간 채 두 턴이 더 지나면 상대가 대화를 접는다.
      // 바닥을 친 뒤에도 계속 말을 섞게 두면 학습도 재미도 없고, 리포트에 쓸 거리만 흐려진다.
      if (state.gauge <= state.difficulty.breakdownLine) {
        state.lowTurns += 1;
        if (state.lowTurns === 1) {
          showError(`${state.stage.characterName} 님이 대화를 접으려 해요. 지금 방향을 바꾸지 않으면 끝납니다.`);
        } else if (state.lowTurns >= 2) {
          el.input.disabled = true;
          el.sendBtn.disabled = true;
          el.micBtn.disabled = true;
          setTimeout(() => endStage('대화 결렬 — 상대가 마음을 닫았어요'), 2600);
          return;
        }
      } else {
        state.lowTurns = 0; // 회복했으면 경고를 푼다
      }

      // 메시지 한도 도달 시 종료 (대사를 읽을 시간을 잠깐 준다)
      if (state.userMsgCount >= state.settings.maxMessagesPerStage) {
        el.input.disabled = true;
        el.sendBtn.disabled = true;
        el.micBtn.disabled = true;
        setTimeout(() => endStage('메시지 한도 도달'), 2000);
      }
    } catch (err) {
      console.error('[play] 채점 요청 오류:', err);
      // 실패한 발화는 기록·카운트하지 않고 입력창에 남겨 재시도할 수 있게 한다
      // (오디오도 되돌려 둬야 다시 보낼 때 어조 평가가 그대로 따라간다)
      state.pendingAudio = audio;
      setBubble(state.history.length > 0 ? state.history[state.history.length - 1].text : state.stage.introDialogue);
      setSending(false);
      showError(err.message || '요청에 실패했어요. 잠시 후 다시 시도해 주세요.');
      el.input.focus();
    }
  }

  // ── 5-1) 마이크 입력 ────────────────────────────────────────
  // 말하는 동안 입력칸에 글자가 실시간으로 찍히고, 멈추면 그 텍스트가 그대로 남는다.
  // 전송은 학습자가 직접 누른다 — 오인식을 손으로 고친 뒤 보낼 수 있게 하기 위함이다.
  if (isVoiceInputSupported()) {
    el.micBtn.hidden = false;

    voice = createVoiceInput({
      maxSeconds: 60,
      onInterim(text) {
        el.input.value = text;
      },
      onFinal(text, audio) {
        // 인식된 게 없으면 입력칸을 건드리지 않는다 (직전에 타이핑한 내용을 지우지 않기 위해)
        if (text) el.input.value = text;
        state.pendingAudio = audio; // 녹음 실패 시 null — 어조 평가만 빠진다
        el.input.focus();
      },
      onState(s) {
        el.micBtn.classList.toggle('listening', s === 'listening');
        el.micBtn.disabled = s === 'processing' || state.sending || state.ended;
        el.micStatus.textContent =
          s === 'listening' ? '🔴 듣는 중… 다 말하면 마이크를 다시 누르세요' : s === 'processing' ? '음성 정리 중…' : '';
        el.input.placeholder =
          s === 'listening' ? '말하는 대로 여기에 적힙니다…' : '당신의 대답을 입력하세요…';
      },
      onError: showError,
    });

    el.micBtn.addEventListener('click', () => {
      if (state.sending || state.ended) return;
      // 새로 말하기 시작하면 이전 녹음은 버린다 (텍스트와 오디오가 어긋나지 않게)
      if (!voice.isListening()) state.pendingAudio = null;
      voice.toggle();
    });
  } else {
    console.info('[play] 이 브라우저는 음성 입력을 지원하지 않습니다 — 타이핑으로 진행합니다.');
  }

  // ── 6) 이벤트 바인딩 ────────────────────────────────────────
  el.sendBtn.addEventListener('click', sendMessage);
  el.input.addEventListener('keydown', (e) => {
    // isComposing: 한글 IME 조합 중 Enter로 오전송되는 것 방지
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  el.endBtn.addEventListener('click', () => endStage('대화 마치기'));
  // 대사창 클릭 시 타이핑 즉시 완성 (비주얼노벨 관례)
  el.dialogue.addEventListener('click', finishTyping);

  // ── 7) 초기 상태 반영 + 타이머 시작 ─────────────────────────
  setBubble(state.stage.introDialogue);
  updateGauge();
  updateEmotion();
  updateMsgCount();
  updateTimer();
  el.input.focus();

  state.timerId = setInterval(() => {
    state.remainingSec -= 1;
    updateTimer();
    if (state.remainingSec <= 0) endStage('시간 종료');
  }, 1000);
}

// ─────────────────────────────────────────────────────────────
// 템플릿
// ─────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHtml(state, totalStages) {
  const stage = state.stage;
  const epNodes = Array.from({ length: totalStages }, (_, i) => {
    const n = i + 1;
    const cls = n === stage.order ? 'ep-node current' : n < stage.order ? 'ep-node past' : 'ep-node';
    return `<div class="${cls}"><span>EP.${pad2(n)}</span></div>`;
  }).join('');

  return `
  <div class="vn emotion-${state.emotion}">
    <!-- ▼ 배경 에셋 슬롯: /assets/{track}/bg/{stageId}.jpg (1920x1080)
         파일이 있으면 .vn-bg-image에 background-image로 들어가고,
         없으면 아래 .vn-bg-placeholder 그라데이션이 그대로 보인다. -->
    <div class="vn-bg-placeholder" aria-hidden="true"></div>
    <div class="vn-bg-image" aria-hidden="true"></div>
    <div class="vn-bg-vignette" aria-hidden="true"></div>

    <!-- ▼ 캐릭터 에셋 슬롯: /assets/{track}/{characterKey}/{emotion}.png (투명 PNG 세로형)
         감정이 바뀌면 두 <img> 레이어가 크로스페이드된다.
         파일이 없으면 .vn-char-placeholder 실루엣이 대신 보인다. -->
    <div class="vn-char-layer">
      <div class="vn-char-glow" aria-hidden="true"></div>
      <img class="vn-char" alt="" />
      <img class="vn-char" alt="" />
      <div class="vn-char-placeholder" data-emotion="${state.emotion}" aria-hidden="true">
        <div class="vn-char-face">🙂</div>
        <div class="vn-char-body"></div>
      </div>
    </div>

    <!-- 좌상단: 챕터 태그 -->
    <div class="vn-chapter">
      <span class="chapter-heart" aria-hidden="true">✦</span>
      <span class="chapter-num">${pad2(stage.order)}</span>
      <span class="chapter-sep">|</span>
      <span class="chapter-title">${escapeHtml(stage.title)}</span>
    </div>

    <!-- 우상단: EP 진행 노드 + 게이지 + 타이머 -->
    <div class="vn-hud">
      <div class="ep-nodes">${epNodes}</div>
      <div class="gauge" title="설득 게이지 (${state.difficulty.successLine} = 성공 기준선)">
        <span class="gauge-heart" aria-hidden="true">✦</span>
        <div class="gauge-track">
          <div class="gauge-fill ${gaugeClass(state.gauge, state.difficulty.successLine)}" style="width:${state.gauge}%"></div>
          <div class="gauge-goal" style="left:${state.difficulty.successLine}%"></div>
        </div>
        <span class="gauge-num">${state.gauge}</span>
      </div>
      <div class="diff-pill" title="이 스테이지의 난이도">Lv${state.difficulty.level} ${levelLabel(state.difficulty.level)}</div>
      <!-- 숨은 의도를 몇 겹 벗겼는지. 단계가 있는 시나리오에서 첫 단서를 얻으면 나타난다 -->
      <div class="clue-meter" hidden title="상대의 숨은 의도를 얼마나 파악했는지"></div>
      <div class="timer">--:--</div>
    </div>

    ${state.fallbackNotice ? `<div class="fallback-notice vn-notice">⚠ ${escapeHtml(state.fallbackNotice)}</div>` : ''}

    <!-- 하단: 대사창 + 입력 -->
    <div class="vn-bottom">
      <div class="vn-dialogue" title="클릭하면 대사가 즉시 나타나요">
        <div class="vn-name-pill">
          ${escapeHtml(stage.characterName)}
          <span class="char-emotion-label">NORMAL</span>
        </div>
        <p class="bubble-text"></p>
        <span class="bubble-next" aria-hidden="true">▼</span>
      </div>

      <div class="vn-input">
        <!-- 마이크: 음성인식을 지원하지 않는 브라우저에서는 초기화 단계에서 숨긴다 -->
        <button class="mic-btn" type="button" hidden aria-label="마이크로 말하기" title="마이크로 말하기">
          <span class="mic-icon" aria-hidden="true">🎤</span>
        </button>
        <input class="chat-input" type="text" maxlength="300" placeholder="당신의 대답을 입력하세요…" autocomplete="off" />
        <button class="send-btn" type="button">
          <span class="send-label">💌 SEND</span>
          <span class="spinner" aria-hidden="true"></span>
        </button>
      </div>
      <div class="vn-input-meta">
        <span class="msg-count">0 / ${state.settings.maxMessagesPerStage}</span>
        <!-- 마이크 상태 안내 (듣는 중 / 정리 중) — 평소에는 비어 있다 -->
        <span class="mic-status" role="status" aria-live="polite"></span>
        <button class="end-btn" type="button">대화 마치기</button>
      </div>
    </div>

    <div class="goal-banner" role="status" aria-live="polite"></div>
    <div class="clue-toast" role="status" aria-live="polite"></div>
    <div class="error-toast"></div>
    <div class="result-overlay"></div>
  </div>`;
}
