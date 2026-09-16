import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { stripFfmpegPlugin } from "./vite-plugins/strip-ffmpeg";
import { pruneFontsPlugin } from "./vite-plugins/prune-fonts";

const isDesktop = process.env.OPENREEL_DESKTOP === "1";

// OPENREEL_LOCAL_FONTS=1 serves the Google fonts from public/fonts/ instead of linking
// fonts.googleapis.com, WITHOUT the rest of the desktop build. The desktop build implies
// it, so nothing about `pnpm build:desktop` changes.
//
// It is its own variable because OPENREEL_DESKTOP does three other things, and one of them
// is fatal here: stripFfmpegPlugin replaces @ffmpeg/core with an empty module, and the Clip
// Studio embed renders its timeline to MP4 in the browser with exactly that. The other two
// (relative asset hrefs, base = "./") are wrong for a build that is served from a fixed
// sub-path. So a build that only wants the fonts asks only for the fonts.
const localFonts = isDesktop || process.env.OPENREEL_LOCAL_FONTS === "1";
const base = process.env.OPENREEL_BASE || (isDesktop ? "./" : "/");

function desktopHtmlPlugin() {
  return {
    name: "openreel-desktop-html",
    transformIndexHtml(html: string) {
      let out = html;
      if (isDesktop) {
        out = out
          .replace(/href="\/favicon\.svg"/g, 'href="./favicon.svg"')
          .replace(/href="\/manifest\.json"/g, 'href="./manifest.json"')
          .replace(/href="\/icons\/icon-192\.png"/g, 'href="./icons/icon-192.png"');
      }
      if (localFonts) {
        out = out.replace(/<link rel="preconnect"[^>]*>\s*/g, "");
        // Written against `base` rather than as "./", because a page served from
        // /edit/<anything> would resolve a relative href against the wrong folder. The
        // stylesheet's own src urls are relative to itself, so the woff2 files follow it.
        out = out.replace(
          /<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g,
          `<link href="${base}fonts/google-fonts.css" rel="stylesheet" />`,
        );
      }
      return out;
    },
  };
}

export default defineConfig({
  // OPENREEL_BASE=/edit/ builds for a sub-path (Clip Studio serves dist under /edit).
  base,
  plugins: [react(), desktopHtmlPlugin(), stripFfmpegPlugin(isDesktop), pruneFontsPlugin(isDesktop)],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "@": path.resolve(__dirname, "./src"),
      "@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
      "@openreel/agent": path.resolve(__dirname, "../../packages/agent/src"),
      "@openreel/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core", "@ffmpeg/core-mt"],
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react";
          if (id.includes("node_modules/zustand")) return "zustand";
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@radix-ui")) return "radix";
        },
      },
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
