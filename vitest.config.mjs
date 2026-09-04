import { defineConfig } from 'vitest/config';

// Test runner configuration for the crosspeel public repository.
// Astro is not loaded here - these tests read the delivered files as text and
// assert against document 01, so no build step and no DOM are needed.
export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    environment: 'node',
    reporters: ['verbose'],
    watch: false,
  },
});
