/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { createApiHandler } from './server/api.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // .env opsiyonel
}

// Paylaşım kartları (og:image vb.) mutlak adres ister; index.html'de %VITE_SITE_URL% olarak kullanılır
process.env.VITE_SITE_URL ??= 'https://berkantkull.github.io/earth-live/';

export default defineConfig({
  // GitHub Pages: https://<kullanıcı>.github.io/<repo>/ altında yayınlanır
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    {
      name: 'earthlive-api',
      configureServer(server) {
        const handler = createApiHandler();
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/')) return next();
          handler(req, res).catch(next);
        });
      },
    },
  ],
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        codeSplitting: {
          // three.js iki parçaya: çekirdek (sahne, geometri, matematik) ve WebGL oluşturucu.
          // Paralel indirilir; uygulama kodu değiştiğinde tarayıcı önbelleğinden gelir.
          groups: [
            { name: 'three-core', test: /node_modules[\\/]three[\\/]build[\\/]three\.core/ },
            { name: 'three-webgl', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
