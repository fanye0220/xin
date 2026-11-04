import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
  };
});
