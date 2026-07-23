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

  const progressLabel = (track) => {
    const p = readProgress(player, track);
    if (!player) return '';
    if (p.status === 'finished') return `✅ 완료됨 · ${p.totalScore}점`;
    if (p.totalScore > 0) return `▶ 진행 중 · ${p.totalScore}점`;
    return '아직 시작 전';
  };

  // 한 트랙만 마쳐도 게임을 끝낼 수 있다 (두 트랙 강제 아님)
  const canFinish = TRACK_SELECT_ORDER.some(isFinished);

  app.innerHTML = `
  <div class="entry track-select">
    <!-- 로그인 화면과 같은 공용 서점 배경 — 화면 전환 시 배경이 유지되는 인상을 준다 -->
    <div class="ui-bg" aria-hidden="true"></div>
    <div class="fx" aria-hidden="true">
      <span>💗</span><span>✦</span><span>🩷</span><span>✧</span><span>💕</span><span>✦</span>
    </div>

    <div class="track-wrap">
      <h1 class="track-heading">어떤 이야기를 펼칠까?</h1>
      <p class="track-sub">
        📖 ${escapeHtml(session.affiliation)} · ${escapeHtml(session.name)} 님 — 책장은 언제든 다시 넘길 수 있어요.
      </p>

      <div class="track-cards">
        ${TRACK_SELECT_ORDER.map((key) => {
          const t = TRACKS[key];
          const done = isFinished(key);
          return `
          <div class="track-slot">
            <button class="track-card track-card-${key} ${done ? 'is-done' : ''}" type="button" data-track="${key}">
              <span class="track-card-emoji" aria-hidden="true">${t.emoji}</span>
              <span class="track-card-title">${escapeHtml(t.cardTitle)}</span>
              <span class="track-card-desc">${escapeHtml(t.cardDesc)}</span>
              <span class="track-card-progress">${escapeHtml(progressLabel(key))}</span>
            </button>
            ${done ? `<button class="track-report-btn" type="button" data-report-track="${key}">📊 리포트 다시 보기</button>` : ''}
          </div>`;
        }).join('')}
      </div>

      <div class="track-footer">
        <button class="entry-btn finish-game" type="button" ${canFinish ? '' : 'disabled'}>
          <span class="entry-btn-label">🏁 게임 마치기</span>
        </button>
        <p class="track-footer-note">
          ${
            canFinish
              ? '한 장만 읽어도 괜찮아요. 마칠 준비가 되면 눌러주세요.'
              : '한 트랙을 끝까지 마치면 게임을 마칠 수 있어요.'
          }
        </p>
        <button class="end-btn track-exit" type="button">나가기</button>
      </div>
    </div>
  </div>`;

  app.querySelectorAll('.track-card').forEach((btn) => {
    btn.addEventListener('click', () => onSelectTrack(btn.dataset.track));
  });
  app.querySelectorAll('.track-report-btn').forEach((btn) => {
    btn.addEventListener('click', () => onShowReport && onShowReport(btn.dataset.reportTrack));
  });
  const finishBtn = app.querySelector('.finish-game');
  if (canFinish && onFinishGame) {
    finishBtn.addEventListener('click', () => onFinishGame());
  }
  app.querySelector('.track-exit').addEventListener('click', onExit);
}
