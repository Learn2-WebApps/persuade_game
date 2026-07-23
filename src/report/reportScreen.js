/**
 * reportScreen.js — 최종 설득 분석 리포트 화면
 *
 * - 저장된 finalReport가 있으면 API 재호출 없이 바로 표시 (비용 절감)
 * - 없으면 POST /api/report 로 생성 → players/{playerId}.finalReports.{track} 에 저장
 * - 리포트는 트랙별로 따로 생성·저장된다 (session.track 기준)
 * - "다시 분석하기"로 강제 재생성 가능
 *
 * 진입 경로는 두 가지다.
 *   1) 트랙의 마지막 스테이지를 마치면 자동으로 (방금 끝낸 트랙 기준)
 *   2) 트랙 선택 화면에서 완료한 트랙의 [리포트 다시 보기] (그 트랙 기준)
 * 어느 쪽이든 닫으면 트랙 선택 화면으로 돌아간다.
 */

import { fetchPlayer, savePlayerReport } from '../common/firebase.js';
import { normalizeTrack, trackLabel } from '../common/tracks.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function initReportScreen({ session, onBack }) {
  const app = document.getElementById('app');
  // 리포트는 트랙별로 따로 생성·저장된다 (선택한 트랙의 스테이지 기준)
  const track = normalizeTrack(session.track);

  renderLoading('리포트를 확인하는 중');

  // 1) 저장된 리포트가 있으면 바로 표시
  let report = null;
  try {
    const player = await fetchPlayer(session.roomCode, session.playerId);
    report = player?.finalReports?.[track] || null;
  } catch (err) {
    console.warn('[report] 저장된 리포트 확인 실패 (새로 생성 시도):', err);
  }

  if (report) {
    renderReport(report, false);
  } else {
    await generate();
  }

  // ── 리포트 생성 (API 호출 → Firestore 저장) ─────────────────
  async function generate() {
    renderLoading('전체 대화를 분석하는 중이에요');
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: session.roomCode, playerId: session.playerId, track }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `리포트 생성 실패 (${res.status})`);
      report = data.report;

      // 저장 실패해도 리포트는 보여준다
      try {
        await savePlayerReport(session.roomCode, session.playerId, track, report);
      } catch (err) {
        console.warn('[report] 리포트 저장 실패 (표시는 계속):', err);
      }
      renderReport(report, true);
    } catch (err) {
      console.error('[report] 생성 실패:', err);
      renderError(err.message || '리포트 생성에 실패했어요.');
    }
  }

  // ── 렌더링 ──────────────────────────────────────────────────
  function renderLoading(message) {
    app.innerHTML = `
    <div class="report">
      <div class="fx fx-soft" aria-hidden="true"><span>✦</span><span>✧</span><span>✧</span><span>✦</span></div>
      <div class="report-loading">
        <div class="report-loading-heart">✦</div>
        <div class="report-loading-text">${escapeHtml(message)}<span class="dots"></span></div>
        <div class="report-loading-sub">모든 스테이지의 대화를 꼼꼼히 읽고 있어요 (최대 30초)</div>
      </div>
    </div>`;
  }

  function renderError(message) {
    app.innerHTML = `
    <div class="report">
      <div class="report-error">
        <p>😢 ${escapeHtml(message)}</p>
        <div class="report-actions">
          <button class="admin-btn retry-report" type="button"><span class="btn-label">다시 시도</span></button>
          <button class="end-btn back-map" type="button">트랙 선택으로 돌아가기</button>
        </div>
      </div>
    </div>`;
    app.querySelector('.retry-report').addEventListener('click', generate);
    app.querySelector('.back-map').addEventListener('click', onBack);
  }

  function renderReport(r, isFresh) {
    const grade = escapeHtml(r.overallGrade || '-');
    const isTop = /^A/.test(r.overallGrade || '');
    const stageScores = (r.stageScores || []).slice().sort((a, b) => a.order - b.order);

    app.innerHTML = `
    <div class="report">
      <div class="fx fx-soft" aria-hidden="true"><span>✦</span><span>✦</span><span>✧</span><span>✧</span><span>✦</span></div>

      <header class="report-topbar">
        <div class="map-title">
          📊 설득 분석 리포트
          <span class="map-track track-${escapeHtml(track)}">${escapeHtml(trackLabel(track))}</span>
        </div>
        <div class="map-player">
          <span class="map-player-info">🏢 ${escapeHtml(session.affiliation)} · ${escapeHtml(session.name)}</span>
        </div>
      </header>

      <section class="report-hero ${isTop ? 'top-grade' : ''}">
        ${isTop ? `<div class="result-sparkles" aria-hidden="true"><span>✦</span><span>✦</span><span>✧</span><span>⭐</span><span>✦</span><span>✧</span></div>` : ''}
        <div class="report-grade">${grade}</div>
        <div class="report-avg">평균 <strong>${r.averageScore}</strong>점 <span class="report-avg-note">(성공 기준 85)</span></div>
        <div class="report-stage-scores">
          ${stageScores
            .map((s) => `<span class="stage-score has" title="${escapeHtml(s.title)}">EP.${String(s.order).padStart(2, '0')} <strong>${s.score}</strong></span>`)
            .join('')}
        </div>
      </section>

      <section class="report-card">
        <h2 class="report-card-title">💬 총평</h2>
        <p class="report-text">${escapeHtml(r.summary)}</p>
      </section>

      <section class="report-card">
        <h2 class="report-card-title">🔍 관찰된 설득 스타일</h2>
        <p class="report-text">${escapeHtml(r.observedStyle)}</p>
      </section>

      <section class="report-card">
        <h2 class="report-card-title">💪 강점</h2>
        ${(r.strengths || [])
          .map(
            (s) => `
          <div class="report-item">
            <div class="report-point">✅ ${escapeHtml(s.point)}</div>
            <blockquote class="report-quote">“${escapeHtml(s.evidence)}”</blockquote>
            <div class="report-detail">${escapeHtml(s.effect)}</div>
          </div>`
          )
          .join('')}
      </section>

      <section class="report-card">
        <h2 class="report-card-title">🌱 아쉬운 점과 제언</h2>
        ${(r.weaknesses || [])
          .map(
            (w) => `
          <div class="report-item">
            <div class="report-point">⚠ ${escapeHtml(w.point)}</div>
            <blockquote class="report-quote weak">“${escapeHtml(w.evidence)}”</blockquote>
            <div class="report-detail">💡 ${escapeHtml(w.suggestion)}</div>
          </div>`
          )
          .join('')}
      </section>

      <section class="report-card">
        <h2 class="report-card-title">🎯 이렇게 해보세요</h2>
        <ul class="report-recs">
          ${(r.recommendations || []).map((rec) => `<li>${escapeHtml(rec)}</li>`).join('')}
        </ul>
      </section>

      <section class="report-card closing">
        <p class="report-closing">💌 ${escapeHtml(r.closingComment)}</p>
      </section>

      <footer class="report-actions">
        <button class="retry-btn back-map" type="button">📚 트랙 선택으로 돌아가기</button>
        <button class="end-btn regen" type="button">🔄 다시 분석하기</button>
      </footer>
      ${isFresh ? '' : `<div class="report-cached-note">저장된 리포트예요. 최신 플레이를 반영하려면 "다시 분석하기"를 눌러주세요.</div>`}
    </div>`;

    app.querySelector('.back-map').addEventListener('click', onBack);
    app.querySelector('.regen').addEventListener('click', generate);
  }
}
