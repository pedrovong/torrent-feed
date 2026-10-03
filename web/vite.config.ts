import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Torrent Feed',
        short_name: 'Feed',
        description: 'Triage new torrents with swipe gestures',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0b0d',
        theme_color: '#2f9e6e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Never cache API responses in the service worker; auth and freshness matter more than offline.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: { proxy: { '/api': process.env.DEV_API ?? 'http://localhost:8080' } },
});
