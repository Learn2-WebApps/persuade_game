/**
 * delete-rooms.js — 방 삭제 스크립트 (옛 데이터 정리용)
 *
 * rooms/{코드} 문서와 그 아래 하위 컬렉션을 통째로 지운다.
 *   rooms/{코드}
 *     stages_work/*, stages_life/*
 *     players/*  →  players/{id}/stageResults_work/*, stageResults_life/*
 * (트랙 도입 이전 방의 옛 stages/·stageResults/ 도 함께 정리한다)
 *
 * Firestore는 문서를 지워도 하위 컬렉션이 자동으로 지워지지 않으므로
 * (지운 문서 아래에 "고아 문서"가 남는다) 아래에서 직접 재귀 삭제한다.
 *
 * 실행:
 *   node scripts/delete-rooms.js DEMO01 3YBV WXEZ      # 확인 후 삭제
 *   node scripts/delete-rooms.js DEMO01 --force        # 확인 없이 삭제
 *   node scripts/delete-rooms.js --list                # 삭제하지 않고 방 목록만 보기
 *
 * ⚠️ 되돌릴 수 없다. 참가자 점수·대화 기록·리포트가 함께 사라진다.
 */

const path = require('path');
const readline = require('readline');
const admin = require('firebase-admin');

let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, '..', 'serviceAccountKey.json'));
} catch (err) {
  console.error('❌ serviceAccountKey.json 파일을 찾을 수 없습니다.');
  console.error('   프로젝트 루트에 서비스 계정 키를 놓아주세요. (발급 방법: README.md 참고)');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// 트랙별 서브컬렉션 이름 규칙 (src/common/tracks.js와 일치)
const TRACKS = ['work', 'life'];

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** 방 목록을 출력한다 (코드·이름·트랙·참가자 수·생성일). */
async function listRooms() {
  const snap = await db.collection('rooms').get();
  if (snap.empty) {
    console.log('방이 하나도 없습니다.');
    return;
  }
  console.log(`\n총 ${snap.size}개 방:\n`);
  for (const doc of snap.docs) {
    const d = doc.data();
    const players = await doc.ref.collection('players').count().get();
    const created = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString('ko-KR', { hour12: false }) : '-';
    // 현재 구조: tracks 배열(두 트랙) / 옛 구조: track 문자열(단일 트랙) → 옛 방은 삭제 대상
    const tracks = Array.isArray(d.tracks)
      ? d.tracks.join('+')
      : d.track
        ? `${d.track} (옛 구조)`
        : '(옛 구조)';
    console.log(
      `  ${doc.id.padEnd(8)} ${tracks.padEnd(16)} 👥${String(players.data().count).padStart(3)}명  ${created}  ${d.roomName || ''}`
    );
  }
  console.log('');
}

/** 방 하나를 하위 컬렉션까지 재귀 삭제한다. */
async function deleteRoom(code) {
  const roomRef = db.collection('rooms').doc(code);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) {
    console.log(`⏭️  rooms/${code} — 존재하지 않아 건너뜁니다.`);
    return false;
  }

  // 트랙별 서브컬렉션까지 내려가서 지운다
  const players = await roomRef.collection('players').get();
  for (const player of players.docs) {
    for (const track of TRACKS) {
      const results = await player.ref.collection(`stageResults_${track}`).get();
      for (const r of results.docs) await r.ref.delete();
    }
    // 트랙 도입 이전 방의 옛 컬렉션도 함께 정리
    const legacy = await player.ref.collection('stageResults').get();
    for (const r of legacy.docs) await r.ref.delete();
    await player.ref.delete();
  }

  let stageCount = 0;
  for (const name of [...TRACKS.map((t) => `stages_${t}`), 'stages']) {
    const stages = await roomRef.collection(name).get();
    for (const s of stages.docs) await s.ref.delete();
    stageCount += stages.size;
  }

  await roomRef.delete();
  console.log(`🗑️  rooms/${code} 삭제 완료 (스테이지 ${stageCount}개, 참가자 ${players.size}명)`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const codes = args.filter((a) => !a.startsWith('--')).map((c) => c.toUpperCase());

  if (args.includes('--list')) {
    await listRooms();
    process.exit(0);
  }

  if (!codes.length) {
    console.error('사용법: node scripts/delete-rooms.js <방코드...> [--force]');
    console.error('        node scripts/delete-rooms.js --list');
    process.exit(1);
  }

  console.log(`삭제 대상: ${codes.join(', ')}`);
  console.log('⚠️  참가자 점수·대화 기록·리포트가 함께 삭제되며 되돌릴 수 없습니다.');
  if (!force) {
    const ok = await confirm('   정말 삭제할까요? (y/N): ');
    if (!ok) {
      console.log('중단했습니다. 삭제된 데이터는 없습니다.');
      process.exit(0);
    }
  }

  let n = 0;
  for (const code of codes) if (await deleteRoom(code)) n++;
  console.log(`\n🏁 ${n}/${codes.length}개 방을 삭제했습니다.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ 삭제 중 오류:', err);
  process.exit(1);
});
