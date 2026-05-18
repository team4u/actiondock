import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          antd: ["antd", "@ant-design/icons"],
          monaco: ["@monaco-editor/react"]
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 5173,
    cors: true,
    proxy: {
      "/api": {
        target: "http://localhost:5177",
        changeOrigin: true
      }
    }
  }
});
