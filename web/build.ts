import * as esbuild from "esbuild";
import { parseArgs } from "@std/cli/parse-args";
import { denoPlugins } from "esbuild-plugin-deno-loader";
import katex from "katex";

const args = parseArgs(Deno.args);
const watch = args.watch;

async function buildHtml() {
  const template = await Deno.readTextFile("index.html.template");
  const formula = "\\mathcal{L} = \\sum_{i} \\frac{1}{2} \\dot{\\theta}_i^2 - J \\sum_{\\langle i,j \\rangle} (1 - \\cos(\\theta_i - \\theta_j)) + M \\sum_{i} \\cos(\\theta_i)";
  const rendered = katex.renderToString(formula, {
    displayMode: true,
    throwOnError: false
  });
  const html = template.replace("{{LAGRANGIAN}}", rendered);
  await Deno.writeTextFile("public/index.html", html);
  console.log("HTML generated.");
}

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
  await buildHtml();
  await ctx.watch();
  console.log("Watching...");
  
  // Watch for template changes
  const watcher = Deno.watchFs("index.html.template");
  for await (const _event of watcher) {
    await buildHtml();
  }
} else {
  await buildHtml();
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Build complete.");
}
