/**
 * stageMapScreen.js — 스테이지 선택 맵
 *
 * - rooms/{코드}/stages를 order 순으로 카드 표시, 상단에 EP.01~ 진행 스트립
 * - 잠금 로직:
 *     · stage1(order 1)은 항상 열림
 *     · 이전 스테이지 완료 시 다음 스테이지 열림 (stageResults 기준)
 *     · 단 settings.activeRounds까지만 — 초과분은 "준비 중"
 * - settings.activeRounds는 onSnapshot 실시간 구독 (관리자 변경 즉시 반영)
 * - 완료 스테이지: 점수 뱃지 + 다시 플레이 가능
 * - 열린 스테이지 전부 완료 시 "전체 완료" 배너 + 리포트 placeholder 버튼
 */

import { fetchStages, fetchStageResults, subscribeRoom } from '../common/firebase.js';
import { trackLabel, normalizeTrack } from '../common/tracks.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function initStageMapScreen({ session, onSelectStage, onExit, onShowReport }) {
  const track = normalizeTrack(session.track);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="map"><div class="map-loading">스테이지 불러오는 중<span class="dots"></span></div></div>`;

  let stages = [];
  let results = {};
  try {
    [stages, results] = await Promise.all([
      fetchStages(session.roomCode, track),
      fetchStageResults(session.roomCode, session.playerId, track),
    ]);
  } catch (err) {
    console.error('[map] 데이터 로드 실패:', err);
    app.innerHTML = `
      <div class="map">
        <div class="map-error">
          <p>스테이지 정보를 불러오지 못했어요.<br/>네트워크 확인 후 다시 시도해 주세요.</p>
          <button class="entry-btn retry" type="button">다시 시도</button>
          <button class="end-btn back" type="button">입장 화면으로</button>
        </div>
      </div>`;
    app.querySelector('.retry').addEventListener('click', () =>
      initStageMapScreen({ session, onSelectStage, onExit, onShowReport })
    );
    app.querySelector('.back').addEventListener('click', onExit);
    return;
  }

  const orderMap = Object.fromEntries(stages.map((s) => [s.id, s.order]));
  let room = null;

  // 룸 문서 실시간 구독 — activeRounds가 바뀌면 맵을 다시 그린다
  const unsubscribe = subscribeRoom(session.roomCode, (r) => {
    room = r;
    render();
  });

  // 화면을 떠날 때 구독을 반드시 해제한다
  const leave = (fn, ...args) => {
    unsubscribe();
    fn(...args);
  };

  function render() {
    const activeRounds = Math.min(room?.settings?.activeRounds ?? stages.length, stages.length);
    const maxCompletedOrder = Math.max(0, ...Object.keys(results).map((id) => orderMap[id] || 0));
    const totalScore = Object.values(results).reduce((sum, r) => sum + (r.stageScore || 0), 0);

    // 스테이지별 상태 계산
    const cards = stages.map((stage) => {
      const result = results[stage.id];
      const adminOpen = stage.order <= activeRounds; // 관리자가 연 범위인가
      const progressOpen = stage.order <= maxCompletedOrder + 1; // 이전 스테이지를 완료했는가 (order 1은 항상 true)
      const state = result && adminOpen ? 'done' : !adminOpen ? 'preparing' : progressOpen ? 'open' : 'locked';
      return { stage, result, state, clickable: state === 'done' || state === 'open' };
    });

    const openCards = cards.filter((c) => c.stage.order <= activeRounds);
    const allDone = openCards.length > 0 && openCards.every((c) => c.result);

    const stateBadge = {
      done: (c) => `⭐ ${c.result.stageScore}점 · 다시 플레이`,
      open: () => `▶ 도전하기`,
      locked: () => `🔒 이전 스테이지를 완료하세요`,
      preparing: () => `⏳ 준비 중`,
    };

    app.innerHTML = `
    <div class="map">
      <div class="fx fx-soft" aria-hidden="true">
        <span>✦</span><span>✦</span><span>✧</span><span>✧</span><span>✦</span>
      </div>
      <header class="map-topbar">
        <div class="map-title">
          설득의 정석
          <span class="map-track track-${escapeHtml(track)}">${escapeHtml(trackLabel(track))}</span>
        </div>
        <!-- 트랙 전환 버튼은 없다: 한 트랙에 들어오면 그 트랙을 마칠 때까지 바꿀 수 없다
             (마치면 리포트를 거쳐 트랙 선택 화면으로 돌아간다) -->
        <div class="map-player">
          <span class="map-player-info">🏢 ${escapeHtml(session.affiliation)} · ${escapeHtml(session.name)}</span>
          <button class="logout-btn" type="button">나가기</button>
        </div>
      </header>

      <div class="map-summary">
        <div class="total-score">누적 점수 <strong>${totalScore}</strong></div>
        <div class="ep-strip">
          ${cards
            .map(
              (c) => `
            <div class="ep-node ep-${c.state}" title="${escapeHtml(c.stage.title)}">
              <span class="ep-label">EP.${String(c.stage.order).padStart(2, '0')}</span>
              <span class="ep-mark">${c.state === 'done' ? '★' : c.state === 'open' ? '●' : c.state === 'preparing' ? '···' : '🔒'}</span>
            </div>`
            )
            .join('<div class="ep-line"></div>')}
        </div>
      </div>

      ${
        allDone
          ? `<div class="all-done-banner">
               🎉 열린 스테이지를 모두 완료했어요! 누적 점수 <strong>${totalScore}</strong>
               <button class="report-btn ready" type="button">📊 설득 리포트 보기</button>
             </div>`
          : ''
      }

      <div class="stage-grid">
        ${cards
          .map(
            (c) => `
          <button class="stage-card state-${c.state}" data-stage-id="${c.stage.id}" type="button"
                  ${c.clickable ? '' : 'disabled'}>
            <div class="card-ep">EP.${String(c.stage.order).padStart(2, '0')}</div>
            <div class="card-title">${escapeHtml(c.stage.title)}</div>
            <div class="card-char">👤 ${escapeHtml(c.stage.characterName)}</div>
            <div class="card-state">${stateBadge[c.state](c)}</div>
          </button>`
          )
          .join('')}
      </div>
    </div>`;

    // 이벤트 바인딩
    app.querySelector('.logout-btn').addEventListener('click', () => leave(onExit));
    const reportBtn = app.querySelector('.report-btn.ready');
    if (reportBtn && onShowReport) {
      reportBtn.addEventListener('click', () => leave(onShowReport));
    }
    app.querySelectorAll('.stage-card:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const stage = stages.find((s) => s.id === btn.dataset.stageId);
        // 플레이 화면에서 결과 저장에 필요한 컨텍스트를 함께 넘긴다
        leave(onSelectStage, stage, {
          orderMap,
          totalStages: stages.length,
          activeRounds,
        });
      });
    });
  }
}
