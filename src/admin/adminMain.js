/**
 * adminMain.js — 관리자 페이지 진입점 (/admin)
 *
 * 로그인(아이디+비밀번호 → /api/admin-auth 검증) 성공 시에만 대시보드 표시.
 * 인증 상태와 자격증명은 sessionStorage에 임시 저장 (탭 닫으면 만료).
 */

import '../style.css';
import './adminStyle.css';
import { initAdminDashboard } from './adminDashboard.js';
import { setAdminAuthed, isAdminAuthed, clearAdminAuth } from './adminApi.js';

function showLogin() {
  const app = document.getElementById('admin-app');
  app.innerHTML = `
  <div class="entry">
    <div class="entry-card">
      <div class="entry-deco">🗝️</div>
      <h1 class="entry-title">관리자</h1>
      <p class="entry-subtitle">설득 게임 진행자(강사) 전용 페이지</p>
      <form class="entry-form" novalidate>
        <!-- name을 "id"로 두면 form.id가 폼 엘리먼트의 DOM id를 가리켜 입력칸을 못 읽는다 -->
        <label class="entry-label">
          아이디
          <input class="entry-input" name="adminId" type="text" placeholder="관리자 아이디" autocomplete="username" />
        </label>
        <label class="entry-label">
          비밀번호
          <input class="entry-input" name="password" type="password" placeholder="관리자 비밀번호" autocomplete="current-password" />
        </label>
        <button class="entry-btn" type="submit">
          <span class="entry-btn-label">로그인</span>
          <span class="spinner" aria-hidden="true"></span>
        </button>
        <div class="entry-error" role="alert"></div>
      </form>
    </div>
    <!-- 첫 화면(학습자 입장)으로 돌아가기.
         .admin-link는 뷰포트 우상단 고정 pill 스타일 — 입장 화면의 "⚙ 관리자"와 대칭 위치다.
         (style.css의 .entry > *:not(.admin-link) 규칙에서 제외돼야 fixed가 유지된다) -->
    <a class="admin-link home-link" href="/" title="학습자 첫 화면으로" aria-label="학습자 첫 화면으로">
      <span aria-hidden="true">🏠</span> 학습자 화면
    </a>
  </div>`;

  const form = app.querySelector('.entry-form');
  const btn = app.querySelector('.entry-btn');
  const errorEl = app.querySelector('.entry-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const id = form.adminId.value.trim();
    const password = form.password.value;
    if (!id || !password) {
      errorEl.textContent = '아이디와 비밀번호를 모두 입력해 주세요.';
      return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const res = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // 관리자 전용 API(방 삭제 등)가 다시 인증할 수 있도록 자격증명도 함께 보관한다
        setAdminAuthed(id, password);
        showDashboard();
      } else {
        // 아이디/비밀번호 중 무엇이 틀렸는지는 서버도 구분해 주지 않는다 (통합 메시지)
        errorEl.textContent = data.error || '아이디 또는 비밀번호가 올바르지 않습니다.';
      }
    } catch (err) {
      console.error('[admin] 로그인 요청 실패:', err);
      errorEl.textContent = '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  form.adminId.focus();
}

function showDashboard() {
  initAdminDashboard({
    onLogout() {
      clearAdminAuth();
      showLogin();
    },
  });
}

isAdminAuthed() ? showDashboard() : showLogin();
