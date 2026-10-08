// @ts-check
import { defineConfig } from 'astro/config';

// The demo is served from GitHub Pages at /typewriter/.
export default defineConfig({
  site: 'https://wisdomousai.github.io',
  base: '/typewriter',
  server: { port: 5214 },
  devToolbar: { enabled: false },
  // The machine is imported late (once the page is up): name its three.js parts up front, so
  // Vite doesn't find them mid-load and reload the page under it.
  vite: {
    optimizeDeps: {
      include: [
        'three',
        'three/addons/loaders/GLTFLoader.js',
        'three/addons/libs/meshopt_decoder.module.js',
        'three/addons/utils/SkeletonUtils.js',
      ],
    },
  },
});
