import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Custom plugin to strip crossorigin from stylesheet links to prevent CORS blocking in Android WebViews
function removeCssCrossorigin() {
  return {
    name: 'remove-css-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/(<link[^>]*rel=["']stylesheet["'][^>]*?) crossorigin(?:=["'][^"']*["'])?/gi, '$1');
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [react(), tailwindcss(), removeCssCrossorigin()],
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');
            if (!normalized.includes('/node_modules/')) return;
            if (normalized.includes('/node_modules/react/') || normalized.includes('/node_modules/react-dom/') || normalized.includes('/node_modules/scheduler/')) {
              return 'vendor-react';
            }
            if (normalized.includes('/node_modules/firebase/') || normalized.includes('/node_modules/@firebase/')) {
              return 'vendor-firebase';
            }
            if (normalized.includes('/node_modules/@google/genai/')) {
              return 'vendor-genai';
            }
            if (normalized.includes('/node_modules/jszip/')) {
              return 'vendor-jszip';
            }
            if (normalized.includes('/node_modules/framer-motion/') || normalized.includes('/node_modules/motion/')) {
              return 'vendor-motion';
            }
            if (normalized.includes('/node_modules/@dnd-kit/')) {
              return 'vendor-dnd';
            }
            if (normalized.includes('/node_modules/lucide-react/')) {
              return 'vendor-icons';
            }
          },
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
