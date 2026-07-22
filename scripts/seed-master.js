/**
 * seed-master.js — 트랙별 마스터 템플릿 시드 스크립트
 *
 * 트랙별 스테이지 시나리오(scripts/stageData.js)와 settings를
 * 트랙 마스터 위치(templates/work, templates/life)에 저장한다.
 * 관리자 페이지의 "새 방 만들기"가 선택한 트랙의 마스터를 복사해 rooms/{코드}를 생성한다.
 *
 * 실행: npm run seed:master
 *       npm run seed:master -- --force        (확인 없이 덮어쓰기)
 *       npm run seed:master -- --track=life   (한 트랙만 시드)
 *
 * 데이터 구조:
 *   templates/{work|life}
 *     name, track, settings{...}, updatedAt
 *     stages/stage1~stage5 (rooms/{코드}/stages와 동일 스키마)
 */

const path = require('path');
const readline = require('readline');
const admin = require('firebase-admin');
const { SETTINGS_BY_TRACK, STAGES_BY_TRACK, TRACK_META } = require('./stageData');

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

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * 트랙 하나의 마스터를 생성한다.
 * 기존 stages는 먼저 지운다 — 스테이지 수가 줄었을 때 유령 문서가 남지 않도록.
 * @returns {Promise<boolean>} 실제로 시드했으면 true, 사용자가 건너뛰면 false
 */
async function seedTrack(track, force) {
  const meta = TRACK_META[track];
  const stages = STAGES_BY_TRACK[track] || [];
  const settings = SETTINGS_BY_TRACK[track];
  const masterRef = db.collection('templates').doc(track);

  if (!stages.length) {
    console.log(`⏭️  [${meta.label}] 스테이지 데이터가 비어 있어 건너뜁니다. (stageData.js를 채워주세요)`);
    return false;
  }

  const existing = await masterRef.get();
  if (existing.exists && !force) {
    console.log(`⚠️  templates/${track} 문서가 이미 존재합니다. (${meta.label})`);
    const ok = await confirm('   덮어쓸까요? (y/N): ');
    if (!ok) {
      console.log('   건너뜁니다. 기존 데이터는 변경되지 않았습니다.');
      return false;
    }
  }

  console.log(`📝 templates/${track} 마스터 생성 중... (${meta.label})`);
  const batch = db.batch();

  const oldStages = await masterRef.collection('stages').get();
  oldStages.forEach((doc) => batch.delete(doc.ref));

  batch.set(masterRef, {
    name: `설득 게임 마스터 템플릿 — ${meta.label}`,
    track,
    trackLabel: meta.label,
    settings: { ...settings },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  for (const stage of stages) {
    batch.set(masterRef.collection('stages').doc(stage.id), stage.data);
  }

  await batch.commit();

  console.log(`✅ [${meta.label}] 스테이지 ${stages.length}개 + settings 저장 완료`);
  stages.forEach((s) =>
    console.log(`   - stages/${s.id}: [${s.data.order}] ${s.data.title} (${s.data.characterName})`)
  );
  return true;
}

async function seedMaster() {
  const force = process.argv.includes('--force');
  const trackArg = process.argv.find((a) => a.startsWith('--track='));
  const requested = trackArg ? [trackArg.split('=')[1]] : Object.keys(TRACK_META);

  const unknown = requested.filter((t) => !TRACK_META[t]);
  if (unknown.length) {
    console.error(`❌ 알 수 없는 트랙: ${unknown.join(', ')} (가능: ${Object.keys(TRACK_META).join(', ')})`);
    process.exit(1);
  }

  let seeded = 0;
  for (const track of requested) {
    if (await seedTrack(track, force)) seeded++;
  }

  console.log(`\n🏁 트랙 ${seeded}/${requested.length}개 시드 완료.`);
  console.log('   이제 관리자 페이지에서 트랙을 골라 "새 방 만들기"를 하면 해당 마스터가 복사됩니다.');
  process.exit(0);
}

seedMaster().catch((err) => {
  console.error('❌ 마스터 시드 실행 중 오류:', err);
  process.exit(1);
});
