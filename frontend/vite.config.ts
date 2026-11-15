import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const api = process.env.API_URL ?? 'http://localhost:8080' // compose frontend proxies the API

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // never swap versions mid-recording; the user reloads from UpdateBanner
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Resonance',
        short_name: 'Resonance',
        description: 'Train your voice in five minutes a day.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#14b3a0',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell and explicit public examples only. Private API responses/audio stay uncached.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}', 'practice-examples/**/*.wav', 'practice-examples/NOTICE.txt'],
        navigateFallbackDenylist: [/^\/api\//, /^\/health\//, /^\/docs/, /^\/openapi\.json/, /^\/practice-examples\//],
      },
    }),
  ],
  server: { proxy: { '/api': { target: api, ws: true }, '/health': api } },
})
