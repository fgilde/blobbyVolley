import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works both at the domain root (local/preview)
  // and under a GitHub Pages project subpath (https://user.github.io/repo/).
  base: './',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
});
