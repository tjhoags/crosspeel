import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://crosspeel.com',
  output: 'static',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
