import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ARTIFACT_DIR = path.join(process.cwd(), "test-results", "release-gate");
const SUMMARY_LOG = path.join(ARTIFACT_DIR, "summary.log");
const SUMMARY_JSON = path.join(ARTIFACT_DIR, "summary.json");

const SUITE_REQUIREMENTS = {
  "test-results/agent-browser": [
    "run.log",
    "manifest.json",
    "01-home.png",
    "02-reasoning-buttons.png",
    "03-renamed.png",
    "04-after-attachment.png",
    "05-non-sensitive-tool-auto-run.png",
  ],
  "test-results/agent-browser-docker-sandboxd": [
    "run.log",
    "manifest.json",
    "01-approval-requested.png",
    "02-approval-approved-result.png",
    "03-approval-denied-result.png",
    "04-non-sensitive-tool-auto-run.png",
    "05-post-multistep-completion.png",
  ],
};

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function appendLog(line) {
  fs.appendFileSync(SUMMARY_LOG, `[${new Date().toISOString()}] ${line}\n`, "utf8");
}

function runCommand(command, args, summary) {
  appendLog(`RUN ${command} ${args.join(" ")}`);
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  const durationMs = Date.now() - startedAt;
  summary.commands.push({
    command: [command, ...args].join(" "),
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    durationMs,
  });
  appendLog(`EXIT ${command} ${args.join(" ")} => ${result.status ?? "null"} in ${durationMs}ms`);
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function isDockerAvailable() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

function assertSuiteArtifacts(dirPath, files) {
  const missing = files
    .map((file) => path.join(process.cwd(), dirPath, file))
    .filter((filePath) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    throw new Error(`Missing required artifacts for ${dirPath}: ${missing.join(", ")}`);
  }
  return {
    dir: path.join(process.cwd(), dirPath),
    files: files.map((file) => path.join(process.cwd(), dirPath, file)),
  };
}

function main() {
  fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const summary = {
    startedAt: new Date().toISOString(),
    artifactDir: ARTIFACT_DIR,
    commands: [],
    suites: [],
  };

  appendLog("Starting release gate");
  runCommand(npmBin(), ["run", "test:unit"], summary);
  runCommand(npmBin(), ["run", "test:agent-browser"], summary);
  summary.suites.push(assertSuiteArtifacts("test-results/agent-browser", SUITE_REQUIREMENTS["test-results/agent-browser"]));

  if (isDockerAvailable()) {
    runCommand(npmBin(), ["run", "test:agent-browser-docker-sandboxd"], summary);
    summary.suites.push(
      assertSuiteArtifacts(
        "test-results/agent-browser-docker-sandboxd",
        SUITE_REQUIREMENTS["test-results/agent-browser-docker-sandboxd"]
      )
    );
  } else {
    appendLog("Skipping docker browser suite because Docker is unavailable");
  }

  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2));
  appendLog(`PASS artifactDir=${ARTIFACT_DIR}`);
}

try {
  main();
} catch (err) {
  appendLog(`FAIL ${(err instanceof Error ? err.message : String(err))}`);
  throw err;
}
