import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5173,
  },
  plugins: [
    {
      name: "serve-root-configs",
      configureServer(server) {
        server.middlewares.use("/configs", (req, res, next) => {
          const file = resolve(__dirname, "../configs", (req.url ?? "").replace(/^\//, ""));
          if (fs.existsSync(file)) {
            res.setHeader("Content-Type", "application/json");
            fs.createReadStream(file).pipe(res);
          } else {
            next();
          }
        });
      },
    },
  ],
});
