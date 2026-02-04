import * as esbuild from "esbuild";
import { parseArgs } from "@std/cli/parse-args";

const args = parseArgs(Deno.args);
const watch = args.watch;

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: "public/bundle.js",
  bundle: true,
  format: "esm",
  sourcemap: true,
  minify: false,
});

if (watch) {
  await ctx.watch();
  console.log("Watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Build complete.");
}
