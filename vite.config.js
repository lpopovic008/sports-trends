import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// IMPORTANT: `base` must match your repository name exactly, with slashes.
// If your repo is github.com/yourname/hot-nut  ->  base: '/hot-nut/'
// If you deploy to a user/org root site (yourname.github.io repo) use base: '/'
export default defineConfig({
  plugins: [react()],
  base: '/hot-nut/',
})