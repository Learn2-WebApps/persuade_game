/**
 * entryScreen.js — 입장 화면
 *
 * 입장 코드 + 이름 + 소속 입력 → rooms/{코드} 조회 →
 *   없거나 closed면 안내, 있으면 player 문서 찾기(이어하기) 또는 생성 → onEntered 콜백
 */

import { isFirebaseConfigured, fetchRoom, getOrCreatePlayer } from '../common/firebase.js';

export function initEntryScreen({ onEntered }) {
  const app = document.getElementById('app');
  app.innerHTML = `
  <div class="entry">
    <!-- 공용 서점 배경 (가로/세로 분기) — 관리자·트랙선택 화면과 같은 .ui-bg를 공유한다 -->
    <div class="ui-bg" aria-hidden="true"></div>
    <div class="fx" aria-hidden="true">
      <span>💗</span><span>✦</span><span>🩷</span><span>✧</span><span>💕</span><span>✦</span><span>💗</span><span>✧</span>
    </div>
    <div class="entry-card">
      <div class="entry-deco">💼</div>
      <h1 class="entry-title"><span class="title-spark">✦</span> 설득의 정석 <span class="title-spark">✦</span></h1>
      <p class="entry-subtitle">오피스 설득 시뮬레이션 — AI 캐릭터를 설득해 보세요</p>

      <form class="entry-form" novalidate>
        <label class="entry-label">
          입장 코드
          <input class="entry-input code-input" name="code" type="text" maxlength="8"
                 placeholder="강사에게 받은 코드 입력" autocomplete="off" spellcheck="false" />
        </label>
        <label class="entry-label">
          이름
          <input class="entry-input" name="name" type="text" maxlength="20" placeholder="홍길동" autocomplete="off" />
        </label>
        <label class="entry-label">
          소속
          <input class="entry-input" name="affiliation" type="text" maxlength="30" placeholder="영업 1팀" autocomplete="off" />
        </label>

        <button class="entry-btn" type="submit">
          <span class="entry-btn-label">입장하기</span>
          <span class="spinner" aria-hidden="true"></span>
        </button>
        <div class="entry-error" role="alert"></div>
      </form>
    </div>
    <!-- 관리자 진입: 우측 상단 고정. 입장 폼(화면 중앙) 흐름을 가리지 않는 위치에 두되,
         강사가 헤매지 않도록 아이콘만이 아니라 글자 라벨을 함께 노출한다. -->
    <a class="admin-link" href="/admin" title="관리자 페이지로 이동" aria-label="관리자 페이지로 이동">
      <span aria-hidden="true">⚙</span> 관리자
    </a>
  </div>`;

  const form = app.querySelector('.entry-form');
  const btn = app.querySelector('.entry-btn');
  const errorEl = app.querySelector('.entry-error');
  const codeInput = app.querySelector('.code-input');

  // 코드는 대문자로 통일 (Firestore 문서 ID가 대문자)
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  function showError(message) {
    errorEl.textContent = message;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');

    const code = form.code.value.trim();
    const name = form.name.value.trim();
    const affiliation = form.affiliation.value.trim();

    // 관리자가 만드는 방 코드는 4자리지만, 수동 생성한 긴 코드도 받도록 4~8자리를 허용한다
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return showError('입장 코드를 확인해 주세요. (영문/숫자 4~8자)');
    if (!name) return showError('이름을 입력해 주세요.');
    if (!affiliation) return showError('소속을 입력해 주세요.');
    if (!isFirebaseConfigured) return showError('Firebase 설정이 아직 없어 입장할 수 없습니다. (README 참고)');

    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const room = await fetchRoom(code);
      if (!room) {
        showError('존재하지 않는 입장 코드예요. 코드를 다시 확인해 주세요.');
        return;
      }
      if (room.status === 'closed') {
        showError('이 룸은 마감되었어요. 진행자에게 문의해 주세요.');
        return;
      }

      const { playerId, isNew } = await getOrCreatePlayer(code, name, affiliation);
      onEntered({ roomCode: code, name, affiliation, playerId, isNew });
    } catch (err) {
      console.error('[entry] 입장 실패:', err);
      showError('입장 처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  codeInput.focus();
}
