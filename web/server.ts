import { serveDir } from "@std/http/file-server";

Deno.serve({ port: 8002 }, (req) => {
  return serveDir(req, {
    fsRoot: "public",
  });
});
