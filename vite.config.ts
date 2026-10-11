import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`     → HTTPS (self-signed) na všetkých rozhraniach, Quest otvorí https://<IP-počítača>:5173
// `npm run dev:usb` → HTTP pre `adb reverse tcp:5173 tcp:5173` a emulátor; localhost je secure context
export default defineConfig(({ mode }) => ({
  base: './',
  // Čas buildu: v správe testu kamery je vidieť, ktorá verzia beží na Queste.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  plugins: mode === 'usb' ? [] : [basicSsl()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  // three.js má sám ~500 kB, varovanie o veľkosti chunku je preto očakávané.
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
}));
