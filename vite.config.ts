import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const shotsDir = path.join(here, "tools", "shots");

// Dev-only middleware: POST a base64 dataURL to /__shot?name=foo -> writes tools/shots/foo.jpg
export default defineConfig({
  // Route bare `three` to the unified WebGPU build so the core, the node
  // materials, and every `three/addons/*` import share ONE copy of the library.
  // (Mixing `three` and `three/webgpu` yields two class sets -> instanceof breaks.)
  resolve: {
    alias: [{ find: /^three$/, replacement: "three/webgpu" }],
  },
  optimizeDeps: {
    // three.webgpu is a large single ESM file; let Vite serve it un-prebundled.
    exclude: ["three"],
  },
  build: {
    // Split the big three.webgpu library into its own cacheable chunk so app-code
    // updates don't force browsers to re-download ~1 MB of engine on every deploy.
    // (Grouping, not duplicating — three stays a single copy, preserving instanceof.)
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
        },
      },
    },
  },
  // Same-origin proxy to the Skyward backend (server/index.mjs) so the browser
  // can reach /api/brain (Ollama), /api/state, /api/contribute without CORS.
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  plugins: [
    {
      name: "shot-saver",
      configureServer(server) {
        server.middlewares.use("/__shot", (req, res) => {
          if (req.method !== "POST") { res.statusCode = 405; return res.end("POST only"); }
          const name = (new URL(req.url || "", "http://x").searchParams.get("name") || "shot").replace(/[^a-z0-9_-]/gi, "");
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            try {
              const b64 = body.replace(/^data:image\/\w+;base64,/, "");
              fs.mkdirSync(shotsDir, { recursive: true });
              fs.writeFileSync(path.join(shotsDir, name + ".jpg"), Buffer.from(b64, "base64"));
              res.end("ok " + name);
            } catch (e: any) {
              res.statusCode = 500; res.end("err " + e.message);
            }
          });
        });
      },
    },
  ],
});
