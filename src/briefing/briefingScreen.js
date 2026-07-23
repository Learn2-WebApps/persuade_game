/**
 * briefingScreen.js — 스테이지 진입 시 "상황 브리핑" 화면
 *
 * 스테이지를 고르면 대화가 바로 시작되지 않고 이 화면이 먼저 뜬다.
 * [START]를 눌러야 대화 화면(playScreen)이 시작된다 — 그전까지 채점·게이지·타이머는 돌지 않는다.
 *
 * 화면 구성:
 *   배경(스테이지 배경) / 왼쪽: 캐릭터(normal) + 이름·직책 / 오른쪽: 상황·목표·조언 카드 / 하단: START
 *
 * 데이터는 스테이지 문서에서 읽는다.
 *   situationBrief / goalBrief / persuasionTip
 * 필드가 없는 옛 방의 스테이지는 기존 situation·persuasionGoal로 대체한다.
 */

import './briefing.css';
import { resolveBackground, resolveCharacter, preloadStageAssets } from '../play/assets.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 브리핑 필드가 없는 옛 스테이지도 화면이 비지 않도록 대체 텍스트를 만든다 */
function readBrief(stage) {
  return {
    situation: stage.situationBrief || stage.situation || '상황 설명이 준비되지 않았어요.',
    goal: stage.goalBrief || stage.persuasionGoal || '상대의 마음을 여는 것이 목표예요.',
    tip:
      stage.persuasionTip ||
      '상대의 감정을 먼저 읽고, 근거와 함께 말하고, 꺼낼 때를 고르자. 이 네 가지가 설득을 만든다.',
  };
}

/**
 * @param {object}   opts
 * @param {object}   opts.stage   - 맵에서 넘겨준 스테이지 문서 ({ id, order, title, … })
 * @param {string}   opts.track   - 'work' | 'life' (에셋 경로 결정용)
 * @param {Function} opts.onStart - [START] 클릭 시 호출 → 대화 시작
 * @param {Function} opts.onBack  - 뒤로(스테이지 맵) 이동
 */
export function initBriefingScreen({ stage, track, onStart, onBack }) {
  const app = document.getElementById('app');
  const brief = readBrief(stage);
  const pad2 = (n) => String(n).padStart(2, '0');

  app.innerHTML = `
  <div class="brief">
    <!-- ▼ 배경: 대화 화면과 같은 슬롯 규칙(/assets/{track}/bg/{stageId}.jpg) -->
    <div class="brief-bg-placeholder" aria-hidden="true"></div>
    <div class="brief-bg" aria-hidden="true"></div>
    <div class="brief-scrim" aria-hidden="true"></div>

    <div class="brief-inner">
      <div class="brief-lead">📖 책장을 넘기자…</div>

      <div class="brief-body">
        <!-- 왼쪽: 대화 상대 -->
        <div class="brief-char">
          <div class="brief-char-frame">
            <img class="brief-char-img" alt="" />
            <div class="brief-char-placeholder" aria-hidden="true">🙂</div>
          </div>
          <div class="brief-char-name">${escapeHtml(stage.characterName || '')}</div>
          ${stage.characterType ? `<div class="brief-char-role">${escapeHtml(stage.characterType)}</div>` : ''}
        </div>

        <!-- 오른쪽: 상황 / 목표 / 조언 -->
        <div class="brief-card">
          <div class="brief-ep">EP.${pad2(stage.order)}</div>
          <h1 class="brief-title">${escapeHtml(stage.title || '')}</h1>

          <section class="brief-block">
            <h2 class="brief-block-head"><span aria-hidden="true">🎬</span> 상황</h2>
            <p class="brief-block-text">${escapeHtml(brief.situation)}</p>
          </section>

          <section class="brief-block">
            <h2 class="brief-block-head"><span aria-hidden="true">🎯</span> 나의 목표</h2>
            <p class="brief-block-text">${escapeHtml(brief.goal)}</p>
          </section>

          <section class="brief-block brief-block-tip">
            <h2 class="brief-block-head"><span aria-hidden="true">💡</span> 설득의 조언</h2>
            <p class="brief-block-text">${escapeHtml(brief.tip)}</p>
          </section>
        </div>
      </div>

      <div class="brief-actions">
        <button class="brief-back" type="button">← 스테이지 맵</button>
        <button class="brief-start" type="button">START ▶</button>
      </div>
    </div>
  </div>`;

  const el = {
    root: app.querySelector('.brief'),
    bg: app.querySelector('.brief-bg'),
    img: app.querySelector('.brief-char-img'),
    startBtn: app.querySelector('.brief-start'),
    backBtn: app.querySelector('.brief-back'),
  };

  // ── 프리로딩 ──────────────────────────────────────────────
  // 학습자가 브리핑(상황·목표·조언)을 읽는 동안, 대화에서 쓸 배경 + 5표정을 미리 캐시에 올린다.
  // 그러면 대화 시작 후 첫 표정 전환이 끊김 없이 즉시 이루어진다.
  // (아래 배경/normal 로드와 URL이 겹치면 assets.js의 _requested 집합이 중복 요청을 막는다.)
  preloadStageAssets(stage, track, stage.id);

  // 배경 — 없으면 플레이스홀더 유지
  {
    const src = resolveBackground(stage, track, stage.id);
    const probe = new Image();
    probe.onload = () => {
      el.bg.style.backgroundImage = `url("${src}")`;
      el.root.classList.add('has-bg');
    };
    probe.onerror = () => console.info(`[brief] 배경 에셋 없음(플레이스홀더 사용): ${src}`);
    probe.src = src;
  }

  // 캐릭터 — 브리핑은 항상 normal 표정
  {
    const src = resolveCharacter(stage, track, 'normal');
    if (src) {
      const probe = new Image();
      probe.onload = () => {
        el.img.src = src;
        el.root.classList.add('has-char');
      };
      probe.onerror = () => console.info(`[brief] 캐릭터 에셋 없음(플레이스홀더 사용): ${src}`);
      probe.src = src;
    }
  }

  el.startBtn.addEventListener('click', () => onStart && onStart());
  el.backBtn.addEventListener('click', () => onBack && onBack());
  el.startBtn.focus();
}
