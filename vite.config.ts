import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig(({command})=>({
  base:'./',
  publicDir:command==='build'?false:'public',
  plugins:[react()],
  optimizeDeps:{exclude:['@sherpaw/asr']},
  worker:{format:'es'},
  build:{
    target:'es2022',outDir:'.cache/web',
    rollupOptions:{input:['index.html','60fps.html'],output:{manualChunks:{pinyin:['pinyin-pro']}}},
  },
}))
