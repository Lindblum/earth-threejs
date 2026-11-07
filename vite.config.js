import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The XR headset emulator is only used in dev; stub it out of production bundles so its ~6 MB of sample rooms aren't shipped.
const stubXrEmulator = {
  name: 'stub-xr-emulator',
  apply: 'build',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './emulate.js' && /[\\/]@pmndrs[\\/]xr[\\/]/.test(importer ?? '')) {
      return '\0xr-emulator-stub';
    }
  },
  load(id) {
    if (id === '\0xr-emulator-stub') return 'export function emulate() {}';
  },
};

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const BASE = './';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, '');
  return {
    plugins: [react(), stubXrEmulator, ...(mode === 'xr' ? [basicSsl()] : [])],
    base: BASE,
    resolve: { dedupe: ['three'] },
    server: {
      host: mode === 'xr' ? true : 'localhost', port: 5177, allowedHosts: env.NGROK_HOST ? [env.NGROK_HOST] : [],
    },
    preview: {
      host: mode === 'xr' ? true : 'localhost', port: 5277, allowedHosts: env.NGROK_HOST ? [env.NGROK_HOST] : [],
    },
  };
});
