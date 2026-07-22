/**
 * endingScreen.js — 아웃트로 컷신이 끝난 뒤의 종료 화면
 *
 * 게임의 마지막 화면이다. 여기서 트랙 선택으로 돌아가면 아직 안 푼 트랙을 이어서
 * 플레이하거나, 이미 푼 트랙의 리포트를 다시 볼 수 있다.
 */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initEndingScreen({ session, onBackToTracks, onExit }) {
  const app = document.getElementById('app');

  app.innerHTML = `
  <div class="entry ending">
    <div class="fx" aria-hidden="true">
      <span>💗</span><span>✦</span><span>🩷</span><span>✧</span><span>💕</span><span>✦</span>
    </div>

    <div class="entry-card ending-card">
      <div class="entry-deco">📖</div>
      <h1 class="entry-title">게임을 완료했습니다</h1>
      <p class="entry-subtitle">
        ${escapeHtml(session.name)} 님, 수고하셨습니다.<br/>
        오늘 읽은 이야기가 내일의 한마디를 바꿔주기를.
      </p>
      <div class="ending-actions">
        <button class="entry-btn back-tracks" type="button">
          <span class="entry-btn-label">트랙 선택으로 돌아가기</span>
        </button>
        <button class="end-btn ending-exit" type="button">나가기</button>
      </div>
    </div>
  </div>`;

  app.querySelector('.back-tracks').addEventListener('click', onBackToTracks);
  app.querySelector('.ending-exit').addEventListener('click', onExit);
}
