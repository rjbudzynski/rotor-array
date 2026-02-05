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
  
  // Get git info
  const ownerCmd = new Deno.Command("git", { args: ["config", "user.name"] });
  const ownerOutput = await ownerCmd.output();
  const owner = new TextDecoder().decode(ownerOutput.stdout).trim() || "Owner";
  
  const hashCmd = new Deno.Command("git", { args: ["rev-parse", "--short", "HEAD"] });
  const hashOutput = await hashCmd.output();
  const hash = new TextDecoder().decode(hashOutput.stdout).trim() || "unknown";
  
  const now = new Date();
  const year = now.getFullYear().toString();
  const dateStr = now.toISOString().split('T')[0];

  let html = template.replace("{{LAGRANGIAN}}", rendered);
  html = html.replace("{{YEAR}}", year);
  html = html.replace("{{OWNER}}", owner);
  html = html.replace("{{DATE}}", dateStr);
  html = html.replace("{{HASH}}", hash);
  
  await Deno.writeTextFile("public/index.html", html);
  console.log("HTML generated.");
}

const ctx = await esbuild.context({
  plugins: [
    ...denoPlugins(),
    {
      name: "html-gen",
      setup(build) {
        build.onEnd(async () => {
          await buildHtml();
        });
      },
    },
  ],
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
