/**
 * seed.js — Firestore 데모 룸 시드 스크립트
 *
 * 실행: node scripts/seed.js
 *       node scripts/seed.js --force   (기존 데이터 확인 없이 덮어쓰기)
 *
 * 사전 준비: 프로젝트 루트에 serviceAccountKey.json 필요 (발급 방법은 README.md 참고)
 * 시나리오 데이터는 scripts/stageData.js 에서 가져온다.
 *
 * ─────────────────────────────────────────────────────────────
 * [게이지 공통 규칙]
 * - 시작값 50, 범위 0~100, 발화당 변동 -15 ~ +20
 * - 85 = 설득 성공 기준선 (도달해도 자동 클리어 아님)
 * - 감정 임계값: happy(80 이상), normal(50~79), worry(30~49), angry(30 미만)
 * ─────────────────────────────────────────────────────────────
 */

const path = require('path');
const readline = require('readline');
const admin = require('firebase-admin');
const { DEFAULT_SETTINGS, STAGES_BY_TRACK, TRACK_META } = require('./stageData');

// ── Firebase Admin 초기화 ──────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, '..', 'serviceAccountKey.json'));
} catch (err) {
  console.error('❌ serviceAccountKey.json 파일을 찾을 수 없습니다.');
  console.error('   프로젝트 루트에 서비스 계정 키를 놓아주세요. (발급 방법: README.md 참고)');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── 시드 데이터 ────────────────────────────────────────────────
const ROOM_CODE = 'DEMO01';

const roomData = {
  roomName: '설득 게임 데모 룸',
  createdBy: 'seed-script',
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  status: 'open',
  tracks: Object.keys(TRACK_META),
  settings: { ...DEFAULT_SETTINGS },
};

// ── 유틸: 콘솔 y/n 확인 ────────────────────────────────────────
function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// ── 시드 실행 ──────────────────────────────────────────────────
async function seed() {
  const force = process.argv.includes('--force');
  const roomRef = db.collection('rooms').doc(ROOM_CODE);

  const existing = await roomRef.get();
  if (existing.exists && !force) {
    console.log(`⚠️  rooms/${ROOM_CODE} 문서가 이미 존재합니다.`);
    const ok = await confirm('   덮어쓸까요? (y/N): ');
    if (!ok) {
      console.log('중단했습니다. 기존 데이터는 변경되지 않았습니다.');
      process.exit(0);
    }
  }

  console.log(`📝 rooms/${ROOM_CODE} 룸 문서 생성 중...`);
  const batch = db.batch();
  batch.set(roomRef, roomData);

  // 방 하나에 두 트랙을 모두 넣는다 (학습자가 입장 후 트랙을 고르는 구조)
  for (const track of Object.keys(TRACK_META)) {
    for (const stage of STAGES_BY_TRACK[track]) {
      batch.set(roomRef.collection(`stages_${track}`).doc(stage.id), stage.data);
    }
  }

  await batch.commit();

  console.log(`✅ 완료! rooms/${ROOM_CODE} 에 두 트랙을 모두 넣었습니다.`);
  for (const track of Object.keys(TRACK_META)) {
    console.log(`   [${TRACK_META[track].label}] stages_${track}`);
    STAGES_BY_TRACK[track].forEach((s) =>
      console.log(`     - ${s.id}: [${s.data.order}] ${s.data.title} (${s.data.characterName})`)
    );
  }
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ 시드 실행 중 오류:', err);
  process.exit(1);
});
