/**
 * cutsceneScreen.js — 컷신 플레이어 (오프닝·아웃트로 공용)
 *
 * 하나의 컷신 = 장면(scene) 배열. 장면 = { background, lines[], bgm }
 *
 * 조작:
 *   화면 클릭 / [다음] → 다음 줄 (타이핑 중이면 그 줄을 즉시 완성)
 *   장면의 마지막 줄까지 끝나면 → 다음 장면 (배경 크로스페이드)
 *   [건너뛰기] → 컷신 전체 스킵
 *
 * 배경 이미지가 없으면 장면별 그라데이션 플레이스홀더를 쓴다 (깨진 이미지 방지).
 */

import './cutscene.css';
import { formatLine } from './josa.js';

const TYPING_SPEED_MS = 34; // 내레이션이라 대화보다 조금 느리게

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 배경 경로에서 플레이스홀더 클래스 키를 뽑는다 (/assets/cutscene/book_open.jpg → book_open) */
function bgKey(path) {
  if (!path) return '';
  const file = String(path).split('/').pop() || '';
  return file.replace(/\.[^.]+$/, '');
}

/**
 * @param {object}   opts
 * @param {Array}    opts.scenes   - [{ background, lines[], bgm }]
 * @param {object}   [opts.vars]   - 대사 토큰 치환값 { name, level, title, comment … }
 * @param {Function} opts.onDone   - 컷신 종료(끝까지 재생 또는 스킵) 시 호출
 */
export function initCutsceneScreen({ scenes, vars = {}, onDone }) {
  const app = document.getElementById('app');

  // 대사를 미리 완성해 둔다 (이름·조사·레벨 치환)
  const script = scenes.map((scene) => ({
    ...scene,
    lines: (scene.lines || []).map((line) => formatLine(line, vars)),
  }));

  app.innerHTML = `
  <div class="cut" role="region" aria-label="컷신">
    <!-- ▼ 배경 슬롯: 두 겹을 크로스페이드한다.
         이미지가 없으면 .cut-bg-placeholder의 장면별 그라데이션이 보인다. -->
    <div class="cut-bg-placeholder" aria-hidden="true"></div>
    <div class="cut-bg cut-bg-a" aria-hidden="true"></div>
    <div class="cut-bg cut-bg-b" aria-hidden="true"></div>
    <div class="cut-vignette" aria-hidden="true"></div>

    <button class="cut-skip" type="button">건너뛰기 ▶▶</button>

    <div class="cut-stage">
      <div class="cut-box">
        <p class="cut-text"></p>
        <div class="cut-controls">
          <span class="cut-progress"></span>
          <button class="cut-next" type="button">다음 ▼</button>
        </div>
      </div>
    </div>
  </div>`;

  const el = {
    root: app.querySelector('.cut'),
    placeholder: app.querySelector('.cut-bg-placeholder'),
    bgA: app.querySelector('.cut-bg-a'),
    bgB: app.querySelector('.cut-bg-b'),
    stage: app.querySelector('.cut-stage'),
    box: app.querySelector('.cut-box'),
    text: app.querySelector('.cut-text'),
    next: app.querySelector('.cut-next'),
    skip: app.querySelector('.cut-skip'),
    progress: app.querySelector('.cut-progress'),
  };

  let sceneIndex = -1; // showScene(0)에서 0이 된다
  let lineIndex = 0;
  let typingTimer = null;
  let typingFull = '';
  let activeBg = 'a';
  let finished = false;
  let currentBackground = null;

  // ── 배경 전환 ────────────────────────────────────────────
  function setBackground(path) {
    // background가 없는 장면은 이전 배경을 유지한다
    if (!path || path === currentBackground) return;
    currentBackground = path;

    // 플레이스홀더는 장면 키로 색을 바꾼다 (이미지가 없어도 장면 전환이 보이도록)
    el.placeholder.dataset.scene = bgKey(path);

    const probe = new Image();
    probe.onload = () => {
      const nextEl = activeBg === 'a' ? el.bgB : el.bgA;
      const prevEl = activeBg === 'a' ? el.bgA : el.bgB;
      nextEl.style.backgroundImage = `url("${path}")`;
      nextEl.classList.add('show');
      prevEl.classList.remove('show');
      activeBg = activeBg === 'a' ? 'b' : 'a';
    };
    probe.onerror = () => {
      // 에셋 미준비 — 플레이스홀더 유지
      console.info(`[cutscene] 배경 에셋 없음(플레이스홀더 사용): ${path}`);
      el.bgA.classList.remove('show');
      el.bgB.classList.remove('show');
      activeBg = 'a';
    };
    probe.src = path;
  }

  // ── 타이핑 ───────────────────────────────────────────────
  function finishTyping() {
    if (!typingTimer) return false;
    clearInterval(typingTimer);
    typingTimer = null;
    el.text.textContent = typingFull;
    el.box.classList.remove('typing');
    return true; // "이번 클릭은 스킵으로 소비됨"
  }

  function typeLine(text) {
    clearInterval(typingTimer);
    typingFull = String(text ?? '');
    el.text.textContent = '';
    el.box.classList.add('typing');
    // 새 줄이 시작될 때 살짝 페이드인
    el.text.classList.remove('cut-text-in');
    void el.text.offsetWidth;
    el.text.classList.add('cut-text-in');

    let i = 0;
    typingTimer = setInterval(() => {
      i += 1;
      el.text.textContent = typingFull.slice(0, i);
      if (i >= typingFull.length) finishTyping();
    }, TYPING_SPEED_MS);
  }

  function updateProgress() {
    el.progress.textContent = `${sceneIndex + 1} / ${script.length}`;
  }

  // ── 진행 ─────────────────────────────────────────────────
  function showScene(index) {
    sceneIndex = index;
    lineIndex = 0;
    const scene = script[sceneIndex];
    setBackground(scene.background);
    updateProgress();
    typeLine(scene.lines[0] ?? '');
  }

  /** 클릭/다음 버튼 — 타이핑 중이면 완성, 아니면 다음 줄/장면 */
  function advance() {
    if (finished) return;
    if (finishTyping()) return;

    const scene = script[sceneIndex];
    if (lineIndex + 1 < scene.lines.length) {
      lineIndex += 1;
      typeLine(scene.lines[lineIndex]);
      return;
    }
    if (sceneIndex + 1 < script.length) {
      showScene(sceneIndex + 1);
      return;
    }
    end();
  }

  function end() {
    if (finished) return;
    finished = true;
    clearInterval(typingTimer);
    typingTimer = null;
    document.removeEventListener('keydown', onKey); // 화면을 떠나므로 키 핸들러 해제
    el.root.classList.add('cut-out'); // 페이드 아웃
    setTimeout(() => onDone && onDone(), 320);
  }

  // ── 이벤트 ───────────────────────────────────────────────
  el.stage.addEventListener('click', advance);
  el.next.addEventListener('click', (e) => {
    e.stopPropagation(); // .cut-stage 클릭과 중복 처리 방지
    advance();
  });
  el.skip.addEventListener('click', (e) => {
    e.stopPropagation();
    end();
  });

  // 키보드: Enter/Space = 다음, Esc = 건너뛰기
  function onKey(e) {
    if (finished) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      advance();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      end();
    }
  }
  document.addEventListener('keydown', onKey);

  showScene(0);
}
