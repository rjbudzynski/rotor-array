import * as esbuild from "esbuild";
import { parseArgs } from "@std/cli/parse-args";
import { denoPlugins } from "esbuild-plugin-deno-loader";
import katex from "katex";
import * as path from "@std/path";
import { copy } from "@std/fs";

const args = parseArgs(Deno.args);
const watch = args.watch;

async function runWasmPack() {
  console.log("Running wasm-pack...");
  const command = new Deno.Command("wasm-pack", {
    args: ["build", "--target", "web"],
    cwd: path.join(Deno.cwd(), "simulation-wasm"),
    env: {
      PATH: `${Deno.env.get("HOME")}/.cargo/bin:${Deno.env.get("PATH")}`,
      RUSTFLAGS: "-C target-feature=+simd128",
    },
  });
  const { success, stderr } = await command.output();
  if (!success) {
    console.error("wasm-pack failed:");
    console.error(new TextDecoder().decode(stderr));
    return false;
  }

  // Copy WASM file to public
  await copy(
    "simulation-wasm/pkg/simulation_wasm_bg.wasm",
    "public/simulation_wasm_bg.wasm",
    { overwrite: true },
  );

  console.log("wasm-pack complete.");
  return true;
}

function minifyHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function buildHtml() {
  const template = await Deno.readTextFile("index.html.template");
  const formula =
    "\\mathcal{L} = \\sum_{i} \\frac{1}{2} \\dot{\\theta}_i^2 - J \\sum_{\\langle i,j \\rangle} (1 - \\cos(\\theta_i - \\theta_j)) + M \\sum_{i} \\cos(\\theta_i)";
  const rendered = katex.renderToString(formula, {
    displayMode: true,
    throwOnError: false,
  });

  // Get git info
  const ownerCmd = new Deno.Command("git", { args: ["config", "user.name"] });
  const ownerOutput = await ownerCmd.output();
  const owner = new TextDecoder().decode(ownerOutput.stdout).trim() || "Owner";

  const hashCmd = new Deno.Command("git", {
    args: ["rev-parse", "--short", "HEAD"],
  });
  const hashOutput = await hashCmd.output();
  const hash = new TextDecoder().decode(hashOutput.stdout).trim() || "unknown";

  const now = new Date();
  const year = now.getFullYear().toString();
  const dateStr = now.toISOString().split("T")[0];

  let html = template.replace("{{LAGRANGIAN}}", rendered);
  html = html.replace("{{YEAR}}", year);
  html = html.replace("{{OWNER}}", owner);
  html = html.replace("{{DATE}}", dateStr);
  html = html.replace("{{HASH}}", hash);

  await Deno.writeTextFile("public/index.html", minifyHtml(html));
  console.log("HTML generated.");
}

async function buildCssBundle() {
  const appCss = await Deno.readTextFile("src/app.css");

  const uPlotUrl = import.meta.resolve("npm:uplot@1.6.30/dist/uPlot.min.css");
  const uPlotCss = await Deno.readTextFile(new URL(uPlotUrl));

  const katexUrl = import.meta.resolve("npm:katex@0.16.11/dist/katex.min.css");
  const katexCss = await Deno.readTextFile(new URL(katexUrl));

  const merged = `${uPlotCss}\n${katexCss}\n${appCss}`;
  const result = await esbuild.transform(merged, {
    loader: "css",
    minify: true,
  });
  await Deno.writeTextFile("public/bundle.css", result.code);
  console.log("CSS bundle generated.");
}

async function copyAssets() {
  await Deno.mkdir("public", { recursive: true });
  try {
    for await (const entry of Deno.readDir("assets")) {
      if (!entry.isFile) continue;
      await Deno.copyFile(`assets/${entry.name}`, `public/${entry.name}`);
    }
    console.log("Assets copied.");
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("No assets directory found, skipping.");
    } else {
      throw e;
    }
  }
}

const ctx = await esbuild.context({
  plugins: [
    ...denoPlugins(),
    {
      name: "wasm-and-html",
      setup(build) {
        build.onStart(async () => {
          await runWasmPack();
        });
        build.onEnd(async () => {
          await buildHtml();
          await buildCssBundle();
          await copyAssets();
        });
      },
    },
  ],
  entryPoints: ["src/main.ts", "src/worker.ts"],
  outdir: "public",
  bundle: true,
  format: "esm",
  sourcemap: true,
  minify: true,
});

if (watch) {
  await ctx.watch();
  console.log("Watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Build complete.");
}
