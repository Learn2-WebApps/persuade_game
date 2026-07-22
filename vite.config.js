import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  // 멀티 페이지: / (학습자 게임) + /admin (관리자)
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  plugins: [
    {
      // 개발 서버에서 /admin → /admin.html 로 연결
      // (배포 환경인 Cloudflare Pages는 /admin 요청 시 admin.html을 자동으로 서빙한다)
      name: 'admin-rewrite',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html';
          next();
        });
      },
    },
  ],
  server: {
    // 로컬 개발 시 /api 요청을 wrangler pages dev(8788)로 프록시한다.
    proxy: {
      '/api': 'http://127.0.0.1:8788',
    },
  },
});
