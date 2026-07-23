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
import { resolveBackground, resolveCharacter } from './assets.js';

const GAUGE_START = 50;
const SUCCESS_LINE = 85;
const TYPING_SPEED_MS = 22; // 대사 타이핑 속도 (글자당)

const EMOTION_META = {
  very_happy: { emoji: '🥰', label: 'VERY HAPPY' },
  happy: { emoji: '😊', label: 'HAPPY' },
  normal: { emoji: '🙂', label: 'NORMAL' },
  worry: { emoji: '😟', label: 'WORRY' },
  angry: { emoji: '😠', label: 'ANGRY' },
};

// 게이지 색 구간은 감정 구간(score.js emotionFor)과 경계를 맞춘다.
const gaugeClass = (g) =>
  g >= 85 ? 'g-very-happy' : g >= 70 ? 'g-happy' : g >= 50 ? 'g-normal' : g >= 30 ? 'g-worry' : 'g-angry';
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
    endBtn: app.querySelector('.end-btn'),
    msgCount: app.querySelector('.msg-count'),
    errorToast: app.querySelector('.error-toast'),
    overlay: app.querySelector('.result-overlay'),
  };

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
    el.gaugeFill.style.width = `${state.gauge}%`;
    el.gaugeFill.className = `gauge-fill ${gaugeClass(state.gauge)}`;
    el.gaugeNum.textContent = state.gauge;
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
    el.sendBtn.classList.toggle('loading', sending);
  }

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
    el.input.disabled = true;
    el.sendBtn.disabled = true;
    el.endBtn.disabled = true;

    const success = state.gauge >= SUCCESS_LINE;
    el.overlay.innerHTML = `
      <div class="result-card ${success ? 'success' : ''}">
        ${
          success
            ? `<div class="result-sparkles" aria-hidden="true"><span>✦</span><span>💗</span><span>✧</span><span>⭐</span><span>✦</span><span>🩷</span></div>`
            : ''
        }
        <div class="result-stage">STAGE ${state.stage.order} 종료</div>
        <div class="result-score">설득 점수 <strong>${state.gauge}</strong></div>
        <div class="result-badge ${success ? 'ok' : 'ng'}">
          ${success ? '🎉 설득 성공!' : `아쉬워요 (성공 기준 ${SUCCESS_LINE})`}
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
        const info = await onEnd(state.gauge, state.turns);
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
    const text = el.input.value.trim();
    if (!text || state.sending || state.ended) return;

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
          conversationHistory: state.history,
          userMessage: text,
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
        characterReply: data.characterReply || '',
        timestamp: Date.now(),
      });
      state.userMsgCount += 1;
      state.gauge = data.newGauge;
      state.emotion = data.newEmotion;

      // 화면 반영
      updateGauge();
      updateEmotion();
      updateMsgCount();
      setBubble(data.characterReply);
      el.input.value = '';
      setSending(false);
      el.input.focus();

      // 메시지 한도 도달 시 종료 (대사를 읽을 시간을 잠깐 준다)
      if (state.userMsgCount >= state.settings.maxMessagesPerStage) {
        el.input.disabled = true;
        el.sendBtn.disabled = true;
        setTimeout(() => endStage('메시지 한도 도달'), 2000);
      }
    } catch (err) {
      console.error('[play] 채점 요청 오류:', err);
      // 실패한 발화는 기록·카운트하지 않고 입력창에 남겨 재시도할 수 있게 한다
      setBubble(state.history.length > 0 ? state.history[state.history.length - 1].text : state.stage.introDialogue);
      setSending(false);
      showError(err.message || '요청에 실패했어요. 잠시 후 다시 시도해 주세요.');
      el.input.focus();
    }
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
      <span class="chapter-heart" aria-hidden="true">💗</span>
      <span class="chapter-num">${pad2(stage.order)}</span>
      <span class="chapter-sep">|</span>
      <span class="chapter-title">${escapeHtml(stage.title)}</span>
    </div>

    <!-- 우상단: EP 진행 노드 + 게이지 + 타이머 -->
    <div class="vn-hud">
      <div class="ep-nodes">${epNodes}</div>
      <div class="gauge" title="설득 게이지 (85 = 성공 기준선)">
        <span class="gauge-heart" aria-hidden="true">💗</span>
        <div class="gauge-track">
          <div class="gauge-fill ${gaugeClass(state.gauge)}" style="width:${state.gauge}%"></div>
          <div class="gauge-goal" style="left:${SUCCESS_LINE}%"></div>
        </div>
        <span class="gauge-num">${state.gauge}</span>
      </div>
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
        <input class="chat-input" type="text" maxlength="300" placeholder="당신의 대답을 입력하세요…" autocomplete="off" />
        <button class="send-btn" type="button">
          <span class="send-label">💌 SEND</span>
          <span class="spinner" aria-hidden="true"></span>
        </button>
      </div>
      <div class="vn-input-meta">
        <span class="msg-count">0 / ${state.settings.maxMessagesPerStage}</span>
        <button class="end-btn" type="button">대화 마치기</button>
      </div>
    </div>

    <div class="error-toast"></div>
    <div class="result-overlay"></div>
  </div>`;
}
