import * as esbuild from "esbuild";
import { parseArgs } from "@std/cli/parse-args";
import { denoPlugins } from "esbuild-plugin-deno-loader";

const args = parseArgs(Deno.args);
const watch = args.watch;

const ctx = await esbuild.context({
  plugins: [...denoPlugins()],
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
