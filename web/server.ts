import { serveDir } from "@std/http/file-server";

Deno.serve({ port: 8000 }, (req) => {
  return serveDir(req, {
    fsRoot: "public",
  });
});
