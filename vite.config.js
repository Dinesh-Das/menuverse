import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['images/**'],
      manifest: {
        name: 'Menuverse',
        short_name: 'Menuverse',
        description: 'Scan your table QR to order instantly',
        theme_color: '#B8860B',
        background_color: '#0a0a0f',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/images/logo.png', sizes: '192x192', type: 'image/png' },
          { src: '/images/logo.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        ],
        // TODO: replace with real app screenshots
        screenshots: [
          {
            src: 'screenshot-menu.png',
            sizes: '390x844',
            type: 'image/png',
            label: 'Browse the interactive menu',
          },
          {
            src: 'screenshot-order.png',
            sizes: '390x844',
            type: 'image/png',
            label: 'Track your order in real time',
          },
        ],
      },
      workbox: {
        navigateFallback: '/offline.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-api', networkTimeoutSeconds: 10 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173
  }
})
