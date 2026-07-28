const { execFileSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const embeddedDocuments = require("../api/_lib/wayman-documents");

const chrome =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const projectRoot = resolve(__dirname, "..");
const resources = join(projectRoot, "resources");
const privateResources = join(projectRoot, "api", "_assets");
const workDirectory = mkdtempSync(join(tmpdir(), "attenor-pdfs-"));

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function markdownToHtml(markdown) {
  const lines = markdown.trim().split("\n");
  const body = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (!inList) body.push("<ul>");
      inList = true;
      body.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      body.push("</ul>");
      inList = false;
    }
    if (line.startsWith("# ")) body.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    else if (line.startsWith("## ")) body.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    else if (line) body.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (inList) body.push("</ul>");

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { size: Letter; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0.7in 0.78in; border-top: 8px solid #b66f4f; color: #18251f;
  font-family: Arial, sans-serif; font-size: 13.5px; line-height: 1.48; }
h1, h2 { font-family: Georgia, serif; }
h1 { max-width: 7in; margin: 0 0 18px; color: #193f34; font-size: 32px; line-height: 1.08; }
h1::before { display: block; margin-bottom: 14px; color: #b66f4f; font: bold 10px Arial, sans-serif;
  letter-spacing: 2px; content: "ATTENOR COLLABORATIVE"; }
h2 { margin: 22px 0 8px; color: #193f34; font-size: 19px; }
p { margin: 0 0 12px; color: #52635b; }
ul { margin: 5px 0 12px; padding-left: 22px; }
li { margin: 6px 0; }
</style></head><body>${body.join("\n")}</body></html>`;
}

function printPdf(html, destination) {
  const htmlPath = join(workDirectory, `${destination.split("/").pop()}.html`);
  writeFileSync(htmlPath, html);
  execFileSync(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${destination}`,
    `file://${htmlPath}`,
  ]);
}

mkdirSync(privateResources, { recursive: true });

for (const name of ["signal-and-scenario-map-v3", "strategy-workflow-map", "coherence-map"]) {
  const markdown = readFileSync(join(resources, `${name}.md`), "utf8");
  printPdf(markdownToHtml(markdown), join(resources, `${name}.pdf`));
}

for (const [key, filename] of [
  ["storyOfImpact", "wayman-story-of-impact.pdf"],
  ["pathToB", "wayman-path-to-b-brief.pdf"],
]) {
  const html = Buffer.from(embeddedDocuments[key], "base64").toString("utf8");
  printPdf(html, join(privateResources, filename));
}

rmSync(workDirectory, { recursive: true, force: true });
