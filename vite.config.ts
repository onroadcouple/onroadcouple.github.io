import { defineConfig } from 'vite';

export default defineConfig({
  // Use './' so all asset paths are relative — required for GitHub Pages
  base: './',
  server: {
    proxy: {
      // Routes Invidious API calls through the dev server to avoid CORS blocks.
      // Only active during `npm run dev` — production uses direct URLs.
      '/inv-proxy': {
        target: 'https://inv.nadeko.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/inv-proxy/, '/api/v1'),
      },
    },
  },
});
