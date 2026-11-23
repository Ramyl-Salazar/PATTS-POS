import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const { version } = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const androidRoot = join(projectRoot, "android");
const localBuildRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "PATTS-POS", "android-build", "app")
  : join(androidRoot, "app", "build");
const androidStudioJbr = process.platform === "win32"
  ? join(process.env.ProgramFiles || "C:\\Program Files", "Android", "Android Studio", "jbr")
  : null;
const candidates = [androidStudioJbr, process.env.JAVA_HOME].filter(Boolean);
let javaHome;

for (const candidate of candidates) {
  try {
    await access(join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java"));
    javaHome = candidate;
    break;
  } catch { /* Try the next known Java runtime. */ }
}

if (!javaHome) throw new Error("A compatible Java runtime was not found. Install Android Studio or set JAVA_HOME.");

const isWindows = process.platform === "win32";
const child = spawn(isWindows ? "cmd.exe" : "./gradlew", isWindows ? ["/d", "/s", "/c", ".\\gradlew.bat assembleDebug"] : ["assembleDebug"], {
  cwd: androidRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${join(javaHome, "bin")}${isWindows ? ";" : ":"}${process.env.PATH || ""}`,
    PATTS_ANDROID_APP_BUILD_DIR: localBuildRoot,
  },
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});

if (exitCode !== 0) process.exit(exitCode ?? 1);

const dist = join(projectRoot, "dist");
const output = join(dist, `PATTS-POS-prototype-v${version.replace(/\.0$/, "")}-debug.apk`);
await mkdir(dist, { recursive: true });
await copyFile(join(localBuildRoot, "outputs", "apk", "debug", "app-debug.apk"), output);
console.log(`APK copied to ${output}`);
