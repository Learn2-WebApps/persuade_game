/**
 * adminDashboard.js — 관리자 대시보드
 *
 * 좌측: 방 목록 + 새 방 만들기 (마스터 템플릿 복사)
 * 우측: 선택한 방 — 코드 안내, 열기/닫기, 설정(실시간 적용), 참가자 모니터링(실시간), CSV
 */

import { fetchStages } from '../common/firebase.js';
import { TRACK_KEYS, TRACKS, trackLabel } from '../common/tracks.js';
import {
  listRooms,
  countPlayers,
  createRoomFromMaster,
  setRoomStatus,
  updateRoomSettings,
  subscribePlayers,
  fetchPlayerResults,
  buildPlayersCsv,
  downloadCsv,
} from './adminFirestore.js';
import { deleteRoomViaApi } from './adminApi.js';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * 방이 실제로 가진 트랙만 뱃지로 보여준다.
 * tracks 배열이 없으면 트랙 도입 이전(구조 A) 방이라 현재 코드와 호환되지 않는다 —
 * 두 트랙을 가진 것처럼 표시하면 오해를 부르므로 "옛 구조"로 표시한다.
 */
function roomTrackChips(room) {
  if (!Array.isArray(room.tracks) || !room.tracks.length) {
    return `<span class="track-chip track-legacy" title="트랙 도입 이전에 만들어진 방 — 새로 만들어야 합니다">옛 구조</span>`;
  }
  return room.tracks
    .filter((t) => TRACK_KEYS.includes(t))
    .map((t) => `<span class="track-chip track-${t}">${escapeHtml(trackLabel(t, { short: true }))}</span>`)
    .join('');
}

const fmtDate = (ts) =>
  ts?.toDate
    ? ts.toDate().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : '-';

export function initAdminDashboard({ onLogout }) {
  const app = document.getElementById('admin-app');

  const state = {
    rooms: [], // [{ code, roomName, status, createdAt, settings, playerCount }]
    selectedCode: null,
    stagesByTrack: {}, // { work: [...], life: [...] } — CSV 컬럼·결과 표시용
    players: [],
    resultsCache: {}, // { playerId: results } — 펼침/CSV용
    expandedPlayerId: null,
    unsubPlayers: null,
  };

  app.innerHTML = `
  <div class="admin">
    <header class="admin-topbar">
      <div class="admin-title">🗂️ 설득 게임 관리자</div>
      <div class="admin-topbar-actions">
        <a class="topbar-home" href="/" title="학습자 첫 화면으로">🏠 학습자 화면</a>
        <button class="logout-btn admin-logout" type="button">로그아웃</button>
      </div>
    </header>
    <div class="admin-body">
      <aside class="admin-rooms">
        <div class="panel-head">
          <span>방 목록</span>
          <button class="mini-btn refresh-rooms" type="button" title="새로고침">↻</button>
        </div>
        <form class="new-room-form">
          <input class="admin-input" name="roomName" type="text" maxlength="30" placeholder="새 방 이름 (예: 3월 신입 교육)" />
          <div class="admin-muted new-room-note">
            방에는 ${Object.values(TRACKS).map((t) => `${t.emoji} ${escapeHtml(t.label)}`).join(' · ')}이
            모두 들어갑니다. 트랙은 학습자가 입장 후 직접 고릅니다.
          </div>
          <button class="admin-btn create-room" type="submit">
            <span class="btn-label">+ 새 방 만들기</span><span class="spinner"></span>
          </button>
          <div class="form-error room-error"></div>
        </form>
        <div class="room-list"><div class="admin-muted">불러오는 중…</div></div>
      </aside>
      <main class="admin-detail">
        <div class="admin-muted detail-empty">왼쪽에서 방을 선택하거나 새 방을 만들어 주세요.</div>
      </main>
    </div>
  </div>`;

  const el = {
    roomList: app.querySelector('.room-list'),
    detail: app.querySelector('.admin-detail'),
    newRoomForm: app.querySelector('.new-room-form'),
    createBtn: app.querySelector('.create-room'),
    roomError: app.querySelector('.room-error'),
  };

  app.querySelector('.admin-logout').addEventListener('click', () => {
    if (state.unsubPlayers) state.unsubPlayers();
    onLogout();
  });
  app.querySelector('.refresh-rooms').addEventListener('click', loadRooms);

  // ── 방 목록 ─────────────────────────────────────────────────
  async function loadRooms() {
    el.roomList.innerHTML = `<div class="admin-muted">불러오는 중…</div>`;
    try {
      const rooms = await listRooms();
      // 참가자 수는 집계 쿼리로 병렬 조회
      const counts = await Promise.all(rooms.map((r) => countPlayers(r.code).catch(() => 0)));
      rooms.forEach((r, i) => (r.playerCount = counts[i]));
      state.rooms = rooms;
      renderRoomList();
    } catch (err) {
      console.error('[admin] 방 목록 로드 실패:', err);
      el.roomList.innerHTML = `<div class="admin-muted">방 목록을 불러오지 못했어요.</div>`;
    }
  }

  function renderRoomList() {
    if (!state.rooms.length) {
      el.roomList.innerHTML = `<div class="admin-muted">아직 방이 없어요. 새 방을 만들어 보세요.</div>`;
      return;
    }
    // 방 카드(선택)와 [삭제] 버튼은 형제로 둔다 — 버튼 안에 버튼을 중첩할 수 없다
    el.roomList.innerHTML = state.rooms
      .map(
        (r) => `
      <div class="room-row">
        <button class="room-item ${r.code === state.selectedCode ? 'selected' : ''}" data-code="${r.code}" type="button">
          <div class="room-item-top">
            <span class="room-code">${r.code}</span>
            <span class="room-status ${r.status === 'open' ? 'st-open' : r.status === 'closed' ? 'st-closed' : 'st-etc'}">
              ${r.status === 'open' ? '진행 중' : r.status === 'closed' ? '마감' : escapeHtml(r.status || '-')}
            </span>
          </div>
          <div class="room-item-name">${escapeHtml(r.roomName || '(이름 없음)')}</div>
          <div class="room-item-meta">
            ${roomTrackChips(r)}
            👥 ${r.playerCount ?? '-'}명 · ${fmtDate(r.createdAt)}
          </div>
        </button>
        <button class="room-delete" data-delete-code="${r.code}" type="button"
                title="이 방을 삭제합니다 (되돌릴 수 없음)" aria-label="${r.code} 방 삭제">🗑</button>
      </div>`
      )
      .join('');
    el.roomList.querySelectorAll('.room-item').forEach((btn) => {
      btn.addEventListener('click', () => selectRoom(btn.dataset.code));
    });
    el.roomList.querySelectorAll('.room-delete').forEach((btn) => {
      btn.addEventListener('click', () => removeRoom(btn.dataset.deleteCode, btn));
    });
  }

  // ── 방 삭제 ────────────────────────────────────────────────
  /**
   * 방과 하위 데이터(참가자·스테이지 결과·스테이지)를 통째로 지운다.
   * 실제 삭제는 관리자 인증이 걸린 /api/admin-delete-room에서 재귀적으로 수행한다.
   */
  async function removeRoom(code, btn) {
    const r = state.rooms.find((x) => x.code === code);
    const label = r?.roomName ? `${code} (${r.roomName})` : code;
    const ok = confirm(
      `정말 삭제하시겠습니까? (되돌릴 수 없음)\n\n방: ${label}\n참가자 ${r?.playerCount ?? '?'}명의 점수·대화 기록·리포트가 함께 사라집니다.`
    );
    if (!ok) return;

    btn.disabled = true;
    btn.textContent = '…';
    try {
      const deleted = await deleteRoomViaApi(code);
      console.log(`[admin] ${code} 삭제됨:`, deleted);

      // 지운 방을 보고 있었다면 상세 패널과 구독을 정리한다
      if (state.selectedCode === code) {
        if (state.unsubPlayers) {
          state.unsubPlayers();
          state.unsubPlayers = null;
        }
        state.selectedCode = null;
        state.players = [];
        state.resultsCache = {};
        state.expandedPlayerId = null;
        el.detail.innerHTML = `<div class="admin-muted detail-empty">왼쪽에서 방을 선택하거나 새 방을 만들어 주세요.</div>`;
      }
      await loadRooms();
    } catch (err) {
      console.error('[admin] 방 삭제 실패:', err);
      alert(err.message || '방 삭제에 실패했어요.');
      btn.disabled = false;
      btn.textContent = '🗑';
    }
  }

  // ── 새 방 만들기 ────────────────────────────────────────────
  el.newRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.roomError.textContent = '';
    const roomName = el.newRoomForm.roomName.value.trim();
    if (!roomName) {
      el.roomError.textContent = '방 이름을 입력해 주세요.';
      return;
    }
    el.createBtn.disabled = true;
    el.createBtn.classList.add('loading');
    try {
      const code = await createRoomFromMaster(roomName);
      el.newRoomForm.roomName.value = '';
      await loadRooms();
      selectRoom(code);
    } catch (err) {
      console.error('[admin] 방 생성 실패:', err);
      el.roomError.textContent = err.message || '방 생성에 실패했어요.';
    } finally {
      el.createBtn.disabled = false;
      el.createBtn.classList.remove('loading');
    }
  });

  // ── 방 선택 → 상세 패널 ─────────────────────────────────────
  async function selectRoom(code) {
    if (state.unsubPlayers) {
      state.unsubPlayers();
      state.unsubPlayers = null;
    }
    state.selectedCode = code;
    state.players = [];
    state.resultsCache = {};
    state.expandedPlayerId = null;
    renderRoomList();

    el.detail.innerHTML = `<div class="admin-muted">방 정보를 불러오는 중…</div>`;
    try {
      // 방에는 두 트랙이 모두 들어 있으므로 트랙별로 읽는다
      const lists = await Promise.all(TRACK_KEYS.map((t) => fetchStages(code, t)));
      state.stagesByTrack = Object.fromEntries(TRACK_KEYS.map((t, i) => [t, lists[i]]));
    } catch (err) {
      console.error('[admin] 스테이지 로드 실패:', err);
      state.stagesByTrack = Object.fromEntries(TRACK_KEYS.map((t) => [t, []]));
    }
    renderDetailShell();

    state.unsubPlayers = subscribePlayers(code, (players) => {
      if (players === null) return;
      state.players = players;
      renderSummary();
      renderPlayersTable();
    });
  }

  const room = () => state.rooms.find((r) => r.code === state.selectedCode);

  function renderDetailShell() {
    const r = room();
    if (!r) return;
    const s = r.settings || {};
    el.detail.innerHTML = `
      <section class="panel room-head-panel">
        <div class="room-big-code" title="학습자에게 안내할 입장 코드">
          <span class="big-code-label">입장 코드</span>
          <span class="big-code">${r.code}</span>
          <button class="mini-btn copy-code" type="button" title="코드 복사">📋 복사</button>
          <span class="copy-done"></span>
        </div>
        <div class="room-head-right">
          <div class="room-head-name">
            ${escapeHtml(r.roomName || '(이름 없음)')}
            ${roomTrackChips(r)}
          </div>
          <label class="status-toggle">
            <input type="checkbox" class="status-check" ${r.status === 'open' ? 'checked' : ''} />
            <span class="status-toggle-label">${r.status === 'open' ? '🟢 열림 (입장 가능)' : '🔴 닫힘 (입장 불가)'}</span>
          </label>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><span>방 설정</span><span class="panel-note">저장 즉시 학습자 화면에 실시간 반영 · 진행 중인 스테이지는 다음 진입부터 적용</span></div>
        <form class="settings-form">
          <label class="settings-label">열어줄 스테이지 수 (activeRounds)
            <select class="admin-input" name="activeRounds">
              ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${s.activeRounds === n ? 'selected' : ''}>${n}개 (EP.01~EP.0${n})</option>`).join('')}
            </select>
          </label>
          <label class="settings-label">스테이지 제한시간 (초)
            <input class="admin-input" name="stageTimeLimit" type="number" min="60" max="1800" step="30" value="${s.stageTimeLimit ?? 300}" />
            <span class="settings-hint"></span>
          </label>
          <label class="settings-label">스테이지당 최대 메시지 수
            <input class="admin-input" name="maxMessagesPerStage" type="number" min="3" max="50" value="${s.maxMessagesPerStage ?? 15}" />
          </label>
          <button class="admin-btn save-settings" type="submit"><span class="btn-label">설정 저장</span><span class="spinner"></span></button>
          <span class="settings-saved"></span>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head">
          <span>참가자 모니터링 <span class="live-dot" title="실시간 반영 중"></span></span>
          <button class="admin-btn ghost export-csv" type="button">⬇ CSV 다운로드</button>
        </div>
        <div class="summary-cards"></div>
        <div class="players-table-wrap"><div class="admin-muted">참가자를 기다리는 중…</div></div>
      </section>`;

    // 코드 복사
    const copyDone = el.detail.querySelector('.copy-done');
    el.detail.querySelector('.copy-code').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(r.code);
        copyDone.textContent = '복사됨!';
        setTimeout(() => (copyDone.textContent = ''), 1500);
      } catch {
        copyDone.textContent = r.code;
      }
    });

    // 열기/닫기 토글
    el.detail.querySelector('.status-check').addEventListener('change', async (e) => {
      const status = e.target.checked ? 'open' : 'closed';
      try {
        await setRoomStatus(r.code, status);
        r.status = status;
        el.detail.querySelector('.status-toggle-label').textContent =
          status === 'open' ? '🟢 열림 (입장 가능)' : '🔴 닫힘 (입장 불가)';
        renderRoomList();
      } catch (err) {
        console.error('[admin] 상태 변경 실패:', err);
        e.target.checked = !e.target.checked;
      }
    });

    // 설정 폼: 초 → 분 힌트
    const form = el.detail.querySelector('.settings-form');
    const hint = form.querySelector('.settings-hint');
    const updateHint = () => {
      const sec = Number(form.stageTimeLimit.value) || 0;
      hint.textContent = `= ${Math.floor(sec / 60)}분 ${sec % 60 ? `${sec % 60}초` : ''}`;
    };
    form.stageTimeLimit.addEventListener('input', updateHint);
    updateHint();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const savedEl = form.querySelector('.settings-saved');
      const btn = form.querySelector('.save-settings');
      const next = {
        activeRounds: Number(form.activeRounds.value),
        stageTimeLimit: Math.max(60, Math.min(1800, Number(form.stageTimeLimit.value) || 300)),
        maxMessagesPerStage: Math.max(3, Math.min(50, Number(form.maxMessagesPerStage.value) || 15)),
      };
      btn.disabled = true;
      btn.classList.add('loading');
      savedEl.textContent = '';
      try {
        await updateRoomSettings(r.code, next);
        r.settings = { ...r.settings, ...next };
        savedEl.textContent = '✅ 저장됨 — 학습자 화면에 실시간 반영';
        setTimeout(() => (savedEl.textContent = ''), 3000);
      } catch (err) {
        console.error('[admin] 설정 저장 실패:', err);
        savedEl.textContent = '⚠ 저장 실패';
      } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    });

    // CSV
    el.detail.querySelector('.export-csv').addEventListener('click', exportCsv);

    renderSummary();
    renderPlayersTable();
  }

  // ── 요약 카드 ───────────────────────────────────────────────
  function renderSummary() {
    const wrap = el.detail.querySelector('.summary-cards');
    if (!wrap) return;
    const scores = state.players.map((p) => p.totalScore || 0);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const cards = [
      ['참가자', `${state.players.length}명`],
      ['평균 점수', scores.length ? avg : '-'],
      ['최고 점수', scores.length ? Math.max(...scores) : '-'],
      ['최저 점수', scores.length ? Math.min(...scores) : '-'],
    ];
    wrap.innerHTML = cards
      .map(([label, value]) => `<div class="summary-card"><div class="summary-value">${value}</div><div class="summary-label">${label}</div></div>`)
      .join('');
  }

  // ── 참가자 테이블 ───────────────────────────────────────────
  function renderPlayersTable() {
    const wrap = el.detail.querySelector('.players-table-wrap');
    if (!wrap) return;
    if (!state.players.length) {
      wrap.innerHTML = `<div class="admin-muted">아직 참가자가 없어요. 코드 <b>${state.selectedCode}</b>를 안내해 주세요.</div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="players-table">
        <thead>
          <tr><th>이름</th><th>소속</th><th>입장시간</th><th>상태</th><th>진행</th><th class="num">총점</th></tr>
        </thead>
        <tbody>
          ${state.players
            .map((p) => {
              const expanded = state.expandedPlayerId === p.id;
              return `
              <tr class="player-row ${expanded ? 'expanded' : ''}" data-id="${p.id}">
                <td>${escapeHtml(p.name || '-')}</td>
                <td>${escapeHtml(p.affiliation || '-')}</td>
                <td>${fmtDate(p.enteredAt)}</td>
                <td>${p.status === 'finished' ? '<span class="chip chip-done">완료</span>' : '<span class="chip chip-active">진행 중</span>'}</td>
                <td>${TRACK_KEYS.map((t) => {
                  const total = state.stagesByTrack[t]?.length || 5;
                  const prog = p.progress?.[t];
                  const done = Math.max(0, Math.min((prog?.currentMaxStageOrder || 1) - 1, total));
                  return `<span class="track-progress">${escapeHtml(trackLabel(t, { short: true }))} ${done}/${total}</span>`;
                }).join(' ')}</td>
                <td class="num"><strong>${p.totalScore ?? 0}</strong></td>
              </tr>
              ${expanded ? `<tr class="results-row"><td colspan="6"><div class="results-box" data-for="${p.id}">스테이지별 점수 불러오는 중…</div></td></tr>` : ''}`;
            })
            .join('')}
        </tbody>
      </table>
      <div class="table-hint">행을 클릭하면 스테이지별 점수가 펼쳐집니다.</div>`;

    wrap.querySelectorAll('.player-row').forEach((row) => {
      row.addEventListener('click', () => togglePlayerResults(row.dataset.id));
    });

    if (state.expandedPlayerId) fillResultsBox(state.expandedPlayerId);
  }

  async function togglePlayerResults(playerId) {
    state.expandedPlayerId = state.expandedPlayerId === playerId ? null : playerId;
    renderPlayersTable();
  }

  async function fillResultsBox(playerId) {
    const box = el.detail.querySelector(`.results-box[data-for="${playerId}"]`);
    if (!box) return;
    try {
      if (!state.resultsCache[playerId]) {
        state.resultsCache[playerId] = await fetchPlayerResults(state.selectedCode, playerId);
      }
      const results = state.resultsCache[playerId];
      const player = state.players.find((p) => p.id === playerId);

      // 트랙별로 점수 + 리포트를 각각 보여준다 (두 트랙은 완전히 독립)
      const renderReport = (report) =>
        report
          ? `
        <div class="admin-report">
          <div class="admin-report-head">
            <span class="admin-report-grade">${escapeHtml(report.overallGrade || '-')}</span>
            <span class="admin-report-summary">${escapeHtml(report.summary || '')}</span>
          </div>
          <details class="admin-report-details">
            <summary>📊 리포트 전체 보기</summary>
            <p><strong>관찰된 스타일:</strong> ${escapeHtml(report.observedStyle || '')}</p>
            ${(report.strengths || [])
              .map((s) => `<p class="rp-strong">💪 ${escapeHtml(s.point)} — <q>${escapeHtml(s.evidence)}</q></p>`)
              .join('')}
            ${(report.weaknesses || [])
              .map((w) => `<p class="rp-weak">🌱 ${escapeHtml(w.point)} — <q>${escapeHtml(w.evidence)}</q><br/><em>💡 ${escapeHtml(w.suggestion)}</em></p>`)
              .join('')}
            ${(report.recommendations || []).map((r) => `<p>🎯 ${escapeHtml(r)}</p>`).join('')}
          </details>
        </div>`
          : `<div class="admin-report-none">아직 최종 리포트가 생성되지 않았어요.</div>`;

      box.innerHTML = TRACK_KEYS.map((track) => {
        const stages = state.stagesByTrack[track] || [];
        const trackResults = results[track] || {};
        const scoresHtml = stages
          .map((s) => {
            const r = trackResults[s.id];
            return `<span class="stage-score ${r ? 'has' : ''}">EP.${String(s.order).padStart(2, '0')} ${
              r ? `<strong>${r.stageScore}</strong>점` : '<em>미완료</em>'
            }</span>`;
          })
          .join('');
        const trackTotal = player?.progress?.[track]?.totalScore ?? 0;
        return `
        <div class="results-track">
          <div class="results-track-head">
            <span class="track-chip track-${track}">${escapeHtml(trackLabel(track, { short: true }))}</span>
            <span class="results-track-total">합계 <strong>${trackTotal}</strong>점</span>
          </div>
          <div class="results-scores">${scoresHtml || '스테이지 정보를 불러오지 못했어요.'}</div>
          ${renderReport(player?.finalReports?.[track])}
        </div>`;
      }).join('');
    } catch (err) {
      console.error('[admin] 결과 로드 실패:', err);
      box.textContent = '점수를 불러오지 못했어요.';
    }
  }

  // ── CSV 내보내기 ────────────────────────────────────────────
  async function exportCsv() {
    const btn = el.detail.querySelector('.export-csv');
    btn.disabled = true;
    btn.textContent = '내보내는 중…';
    try {
      // 모든 참가자의 stageResults 수집 (캐시 활용)
      const resultsByPlayer = {};
      await Promise.all(
        state.players.map(async (p) => {
          if (!state.resultsCache[p.id]) {
            state.resultsCache[p.id] = await fetchPlayerResults(state.selectedCode, p.id);
          }
          resultsByPlayer[p.id] = state.resultsCache[p.id];
        })
      );
      const csv = buildPlayersCsv(state.players, resultsByPlayer, state.stagesByTrack);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '');
      downloadCsv(csv, `설득게임_${state.selectedCode}_${stamp}.csv`);
    } catch (err) {
      console.error('[admin] CSV 내보내기 실패:', err);
      alert('CSV 내보내기에 실패했어요. 콘솔을 확인해 주세요.');
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ CSV 다운로드';
    }
  }

  loadRooms();
}
