/**
 * trackSelectScreen.js — 트랙 선택 화면
 *
 * 오프닝 컷신 직후, 그리고 한 트랙의 리포트를 본 뒤 돌아오는 허브 화면이다.
 * 한 방에 업무·일상 두 트랙이 모두 들어 있고, 학습자가 여기서 고른다.
 * (일상 트랙을 왼쪽/앞에 노출한다 — TRACK_SELECT_ORDER)
 *
 * 두 트랙의 진행상황은 완전히 독립이라, 각 카드에 해당 트랙의 진행 상태를 함께 보여준다.
 *   · 아직 안 푼 트랙 → 카드를 눌러 플레이
 *   · 이미 완료한 트랙 → "완료됨" 표시 + [리포트 다시 보기]
 *   · 한 트랙이라도 완료했으면 하단 [게임 마치기]가 열린다 (→ 아웃트로 컷신)
 */

import { TRACKS, TRACK_SELECT_ORDER } from '../common/tracks.js';
import { fetchPlayer, readProgress } from '../common/firebase.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function initTrackSelectScreen({ session, onSelectTrack, onShowReport, onFinishGame, onExit }) {
  const app = document.getElementById('app');

  // 트랙별 진행상황을 먼저 읽어 카드에 표시한다 (실패해도 선택은 가능해야 하므로 조용히 무시)
  let player = null;
  try {
    player = await fetchPlayer(session.roomCode, session.playerId);
  } catch (err) {
    console.error('[track] 진행상황 로드 실패:', err);
  }

  const isFinished = (track) => readProgress(player, track).status === 'finished' && !!player;

  const TOTAL_EPISODES = 5;

  /** 다 읽은 편 수 — 진행도 점을 채우는 데 쓴다 */
  const doneCount = (track) => {
    const p = readProgress(player, track);
    if (!player) return 0;
    if (p.status === 'finished') return TOTAL_EPISODES;
    // currentMaxStageOrder는 "다음에 열릴 편"이라 하나를 뺀다
    return Math.max(0, Math.min(TOTAL_EPISODES, (p.currentMaxStageOrder || 1) - 1));
  };

  /** 책을 읽어 내려간 만큼 점이 차오른다 (상태 뱃지보다 진행이 한눈에 보인다) */
  const episodeDots = (track) => {
    const done = doneCount(track);
    return Array.from(
      { length: TOTAL_EPISODES },
      (_, i) => `<i class="dot${i < done ? ' is-read' : ''}"></i>`
    ).join('');
  };

  const stateLine = (track) => {
    const p = readProgress(player, track);
    if (!player) return '';
    if (p.status === 'finished') return `끝까지 읽음 · ${p.totalScore}점`;
    const done = doneCount(track);
    if (done > 0) return `${done}편까지 읽음 · ${p.totalScore}점`;
    return '아직 펼치지 않음';
  };

  /** 장의 분위기를 보여주는 삽화 — 각 트랙 첫 스테이지의 실제 배경을 쓴다 */
  const plateImage = (track) => `/assets/${track}/bg/stage1.jpg`;

  // 한 트랙만 마쳐도 게임을 끝낼 수 있다 (두 트랙 강제 아님)
  const canFinish = TRACK_SELECT_ORDER.some(isFinished);

  app.innerHTML = `
  <div class="entry track-select">
    <!-- 로그인 화면과 같은 공용 서점 배경 — 화면 전환 시 배경이 유지되는 인상을 준다 -->
    <div class="ui-bg" aria-hidden="true"></div>
    <div class="fx" aria-hidden="true">
      <span>✦</span><span>✦</span><span>✧</span><span>✧</span><span>✦</span><span>✦</span>
    </div>

    <div class="track-wrap">
      <header class="track-head">
        <span class="track-kicker">설득의 정석</span>
        <h1 class="track-heading">어떤 장을 펼칠까</h1>
        <p class="track-sub">
          ${escapeHtml(session.affiliation)} · ${escapeHtml(session.name)} 님 — 책장은 언제든 다시 넘길 수 있습니다
        </p>
      </header>

      <div class="chapters">
        ${TRACK_SELECT_ORDER.map((key, i) => {
          const t = TRACKS[key];
          const done = isFinished(key);
          return `
          <article class="chapter chapter-${key}${done ? ' is-done' : ''}">
            <button class="chapter-open" type="button" data-track="${key}"
                    aria-label="${escapeHtml(t.cardTitle)} 펼치기">
              <span class="chapter-plate">
                <span class="chapter-art" style="background-image:url('${plateImage(key)}')"></span>
                ${done ? '<span class="chapter-ribbon" aria-hidden="true"></span>' : ''}
              </span>
              <span class="chapter-body">
                <span class="chapter-num">제 ${i + 1} 장</span>
                <span class="chapter-title">${escapeHtml(t.cardTitle)}</span>
                <span class="chapter-desc">${escapeHtml(t.cardDesc)}</span>
                <span class="chapter-meta">
                  <span class="chapter-dots" aria-hidden="true">${episodeDots(key)}</span>
                  <span class="chapter-state">${escapeHtml(stateLine(key))}</span>
                </span>
              </span>
            </button>
            ${done ? `<button class="chapter-report" type="button" data-report-track="${key}">읽은 기록 보기</button>` : ''}
          </article>`;
        }).join('')}
      </div>

      <footer class="track-foot">
        <button class="book-close finish-game" type="button" ${canFinish ? '' : 'disabled'}>책을 덮는다</button>
        <p class="track-foot-note">
          ${
            canFinish
              ? '한 장만 읽어도 괜찮습니다. 마칠 준비가 되면 눌러주세요.'
              : '한 장을 끝까지 읽으면 책을 덮을 수 있습니다.'
          }
        </p>
        <button class="track-exit" type="button">나가기</button>
      </footer>
    </div>
  </div>`;

  app.querySelectorAll('.chapter-open').forEach((btn) => {
    btn.addEventListener('click', () => onSelectTrack(btn.dataset.track));
  });
  app.querySelectorAll('.chapter-report').forEach((btn) => {
    btn.addEventListener('click', () => onShowReport && onShowReport(btn.dataset.reportTrack));
  });
  const finishBtn = app.querySelector('.finish-game');
  if (canFinish && onFinishGame) {
    finishBtn.addEventListener('click', () => onFinishGame());
  }
  app.querySelector('.track-exit').addEventListener('click', onExit);
}
