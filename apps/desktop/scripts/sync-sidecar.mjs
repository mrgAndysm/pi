import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");

const srcDir = join(repoRoot, "packages", "coding-agent", "binaries", "windows-x64");
const dstDir = join(__dirname, "..", "src-tauri", "binaries");

if (!existsSync(srcDir)) {
    console.error(`ERROR: 源目录不存在: ${srcDir}`);
    console.error("请先编译 pi 二进制: npm run build && bash scripts/build-binaries.sh --skip-install --skip-build --platform windows-x64");
    process.exit(1);
}

mkdirSync(dstDir, { recursive: true });

// sidecar 命名需遵循 Tauri 约定: <bin>-<target-triple>[.exe]
const exeName = "pi-x86_64-pc-windows-msvc.exe";
copyFileSync(join(srcDir, "pi.exe"), join(dstDir, exeName));

// 同步运行时资源
const resources = ["theme", "assets", "export-html", "docs", "examples", "native", "photon_rs_bg.wasm", "package.json", "README.md", "CHANGELOG.md"];
for (const name of resources) {
    const src = join(srcDir, name);
    const dst = join(dstDir, name);
    if (!existsSync(src)) {
        console.warn(`WARN: 资源缺失: ${src}`);
        continue;
    }
    cpSync(src, dst, { recursive: true, force: true });
}

console.log(`sidecar synced: ${exeName} + ${resources.length} resources → ${dstDir}`);
