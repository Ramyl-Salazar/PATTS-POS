import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const androidRoot = join(projectRoot, "android");
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
  } catch { /* Try the next configured runtime. */ }
}

if (!javaHome) throw new Error("A compatible Java runtime was not found. Install Android Studio or set JAVA_HOME.");

const isWindows = process.platform === "win32";
const args = isWindows
  ? ["/d", "/s", "/c", ".\\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug"]
  : [":app:testDebugUnitTest", ":app:lintDebug", ":app:assembleDebug"];
const child = spawn(isWindows ? "cmd.exe" : "./gradlew", args, {
  cwd: androidRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${join(javaHome, "bin")}${isWindows ? ";" : ":"}${process.env.PATH || ""}`,
    PATTS_ANDROID_APP_BUILD_DIR: process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "PATTS-POS", "android-studio-build", "app")
      : join(androidRoot, "app", "build"),
  },
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (exitCode !== 0) process.exit(exitCode ?? 1);
