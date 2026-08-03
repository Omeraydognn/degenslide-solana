import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // NOTE: no manualChunks. Hand-splitting vendors by path produced a circular
    // chunk graph (`vendor -> react -> vendor`), which loaded framer-motion
    // before React had initialised — the production bundle then died at import
    // time with "Cannot read properties of undefined (reading 'useLayoutEffect')"
    // and rendered a blank page. The dev server never bundles, so this only ever
    // reproduced on a real build. Rollup's automatic splitting orders chunks
    // correctly; leave it alone unless a change is verified against `vite preview`.
    chunkSizeWarningLimit: 1500,
  },
});