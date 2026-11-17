import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri espera uma porta fixa e não quer que o Vite limpe a tela do terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // O WebView do macOS 13+ e o WebView2 do Windows entendem JavaScript moderno.
    target: "es2022",
    cssMinify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Ícones num pacote só (em vez de um arquivinho por ícone) e React separado do código do app.
        manualChunks(id: string) {
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/react")) return "react";
          return undefined;
        },
      },
    },
  },
});
