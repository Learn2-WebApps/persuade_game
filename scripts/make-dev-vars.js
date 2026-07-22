/**
 * make-dev-vars.js — serviceAccountKey.json에서 .dev.vars 파일을 생성한다.
 *
 * 실행: node scripts/make-dev-vars.js
 *
 * GEMINI_API_KEY 는 placeholder로 넣으므로 생성 후 직접 채워야 한다.
 * ADMIN_ID / ADMIN_PASSWORD 는 개발용 기본값(learn2 / 0067)을 넣는다 — 배포 시엔 반드시 교체.
 * 이미 .dev.vars 가 있으면 덮어쓰지 않는다.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, '.dev.vars');

if (fs.existsSync(target)) {
  console.log('⚠️  .dev.vars 가 이미 존재합니다. 덮어쓰지 않고 종료합니다.');
  process.exit(0);
}

let sa;
try {
  sa = JSON.parse(fs.readFileSync(path.join(root, 'serviceAccountKey.json'), 'utf8'));
} catch {
  console.error('❌ serviceAccountKey.json 을 찾을 수 없습니다. (발급 방법: README.md 참고)');
  process.exit(1);
}

const content = [
  `GEMINI_API_KEY=여기에_GEMINI_API_키`,
  `FIREBASE_PROJECT_ID=${sa.project_id}`,
  `FIREBASE_CLIENT_EMAIL=${sa.client_email}`,
  `FIREBASE_PRIVATE_KEY="${sa.private_key.replace(/\n/g, '\\n')}"`,
  // 로컬 실행 표시 — 이 값이 development일 때만 관리자 자격증명 기본값 폴백이 허용된다
  `ENVIRONMENT=development`,
  // 관리자 로그인 — 개발용 기본값을 그대로 넣어둔다 (배포 시엔 Cloudflare Secret에 다른 값으로)
  `ADMIN_ID=learn2`,
  `ADMIN_PASSWORD=0067`,
  '',
].join('\n');

fs.writeFileSync(target, content, 'utf8');
console.log('✅ .dev.vars 생성 완료. GEMINI_API_KEY 를 직접 채워주세요.');
console.log('   관리자 로그인은 개발용 기본값 learn2 / 0067 로 넣어두었습니다 (배포 전 변경 필수).');
