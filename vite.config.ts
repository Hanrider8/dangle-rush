import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`     → HTTPS (self-signed) na všetkých rozhraniach, Quest otvorí https://<IP-počítača>:5173
// `npm run dev:usb` → HTTP pre `adb reverse tcp:5173 tcp:5173` a emulátor; localhost je secure context
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'usb' ? [] : [basicSsl()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  // three.js má sám ~500 kB, varovanie o veľkosti chunku je preto očakávané.
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
}));
