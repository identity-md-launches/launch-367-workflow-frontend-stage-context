import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "runtime-deployment-in-development",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = (req.url ?? "").split("?")[0];
          if (
            path !== "/imd-deployment.json" &&
            !/^\/abi\/[A-Za-z]+\.json$/.test(path)
          )
            return next();
          try {
            const content = await readFile(
              new URL(`../dist${path}`, import.meta.url),
            );
            res.setHeader("Content-Type", "application/json");
            res.end(content);
          } catch {
            res.statusCode = 503;
            res.end(
              "Run npm run build to generate the verified deployment first.",
            );
          }
        });
      },
    },
  ],
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
});
