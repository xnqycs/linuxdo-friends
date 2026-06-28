import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const distDir = resolve("dist");
const packagesDir = resolve("packages");
const zipName = parseZipName(process.argv.slice(2));
const outputPath = join(packagesDir, zipName);

if (!existsSync(join(distDir, "manifest.json"))) {
  console.error("dist/manifest.json was not found. Run npm run build before packaging.");
  process.exit(1);
}

mkdirSync(packagesDir, { recursive: true });
rmSync(outputPath, { force: true });

const result = spawnSync("zip", ["-r", "-q", outputPath, "."], {
  cwd: distDir,
  stdio: "inherit"
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Created ${outputPath}`);

function parseZipName(args) {
  const nameFlagIndex = args.indexOf("--name");
  const rawName = nameFlagIndex >= 0 ? args[nameFlagIndex + 1] : "linuxdo-friends.zip";
  if (!rawName) {
    console.error("Missing value for --name.");
    process.exit(1);
  }
  const fileName = basename(rawName);
  if (!/^[a-zA-Z0-9._-]+\.zip$/.test(fileName)) {
    console.error(`Invalid zip file name: ${rawName}`);
    process.exit(1);
  }
  return fileName;
}
