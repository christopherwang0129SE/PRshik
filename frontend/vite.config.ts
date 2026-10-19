import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

// Absolute paths to the bundled demos, resolved from this config's location
// so the dashboard buttons work from any checkout. An empty env value hides
// that button; an unset variable keeps the default.
const configuredPath = (envName: string, fallback: string): string => {
  const value = process.env[envName]
  if (value === undefined) return fallback
  return value.trim()
}

const demoRepoPath = configuredPath(
  'VITE_DEMO_REPO_PATH',
  path.resolve(here, '../demo/checkout-demo'),
)
const apiDemoRepoPath = configuredPath(
  'VITE_API_DEMO_REPO_PATH',
  path.resolve(here, '../demo/api-demo'),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_DEMO_REPO_PATH': JSON.stringify(demoRepoPath),
    'import.meta.env.VITE_API_DEMO_REPO_PATH': JSON.stringify(apiDemoRepoPath),
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
