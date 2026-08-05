import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Booting a real Postgres and applying every migration takes a while on a
    // cold run; the isolation suite is worth the wait.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One Postgres instance, one connection, shared across files. Tests wrap
    // themselves in rolled-back transactions, so they must not run concurrently
    // against that single connection.
    fileParallelism: false,
    maxWorkers: 1,
  },
})
