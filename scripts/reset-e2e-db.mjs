import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.REMCOCHAT_DB_PATH
  ? path.resolve(process.env.REMCOCHAT_DB_PATH)
  : path.join(process.cwd(), "data", "remcochat-e2e.sqlite");

const configPath = process.env.REMCOCHAT_CONFIG_PATH
  ? path.resolve(process.env.REMCOCHAT_CONFIG_PATH)
  : path.join(process.cwd(), "data", "remcochat-e2e-config.toml");

const exampleConfigPath = path.join(process.cwd(), "config.toml.example");
const enableVercelSandboxBash = process.env.REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX === "1";
const enableDockerSandboxdBash = process.env.REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD === "1";
const dockerSandboxdUrl = String(
  process.env.REMCOCHAT_E2E_DOCKER_SANDBOXD_URL ?? "http://127.0.0.1:8080"
).trim();

function tomlString(value) {
  return `"${String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')}"`;
}

try {
  fs.rmSync(dbPath, { force: true });
} catch {
  // ignore
}

try {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const example = fs.readFileSync(exampleConfigPath, "utf8");
  const extra = [
    "",
    "[providers.e2e_alt]",
    'name = "E2E OpenCode (default)"',
    'base_url = "https://opencode.ai/zen/v1"',
    'api_key_env = "OPENCODE_API_KEY"',
    'modelsdev_provider_id = "opencode"',
    'default_model_id = "gpt-5.2-codex"',
    "allowed_model_ids = [",
    '  "gpt-5-nano",',
    '  "gpt-5.2",',
    '  "gpt-5.2-codex",',
    '  "claude-opus-4-5",',
    '  "alpha-glm-4.7",',
    "]",
    "",
    "[providers.e2e_vercel]",
    'name = "E2E Vercel Catalog (opt-in)"',
    'base_url = "https://ai-gateway.vercel.sh/v3/ai"',
    'api_key_env = "VERCEL_AI_GATEWAY_API_KEY"',
    'modelsdev_provider_id = "vercel"',
    'default_model_id = "anthropic/claude-opus-4.5"',
    "allowed_model_ids = [",
    '  "anthropic/claude-opus-4.5",',
    '  "openai/gpt-3.5-turbo",',
    "]",
    "",
  ].join("\n");
  let configText = example.trimEnd();

  // Default to OpenCode in E2E environments to avoid relying on Vercel credits.
  configText = configText.replace(/\[app\][\s\S]*?(?=\n\[|$)/, (block) => {
    return block.replace(
      /\bdefault_provider_id\s*=\s*\"[^\"]+\"/,
      'default_provider_id = "e2e_alt"'
    );
  });
  configText = configText.replace(/\[app\.router\][\s\S]*?(?=\n\[|$)/, (block) => {
    let out = block;
    out = out.replace(/\bprovider_id\s*=\s*\"[^\"]+\"/, 'provider_id = "e2e_alt"');
    out = out.replace(/\bmodel_id\s*=\s*\"[^\"]+\"/, 'model_id = "gpt-5-nano"');
    return out;
  });

  if (enableVercelSandboxBash || enableDockerSandboxdBash) {
    const root = tomlString(process.cwd());

    configText = configText.replace(
      /\[app\.bash_tools\][\s\S]*?(?=\n\[|$)/,
      (block) => {
        let out = block;
        out = out.replace(/\benabled\s*=\s*false\b/, "enabled = true");
        if (enableDockerSandboxdBash) {
          if (/\bprovider\s*=/.test(out)) {
            out = out.replace(/\bprovider\s*=\s*\"[^\"]+\"/, 'provider = "docker"');
          } else {
            out = out.replace(/\[app\.bash_tools\]\n/, '[app.bash_tools]\nprovider = "docker"\n');
          }
        }
        out = out.replace(/\baccess\s*=\s*\"[^\"]+\"/, 'access = "localhost"');
        out = out.replace(/\bproject_root\s*=\s*\"[^\"]*\"/, `project_root = ${root}`);
        return out;
      }
    );

    if (enableDockerSandboxdBash) {
      configText = configText.replace(
        /\[app\.bash_tools\.docker\][\s\S]*?(?=\n\[|$)/,
        (block) => {
          let out = block;
          out = out.replace(
            /\borchestrator_url\s*=\s*\"[^\"]*\"/,
            `orchestrator_url = ${tomlString(dockerSandboxdUrl)}`
          );
          out = out.replace(/\bnetwork_mode\s*=\s*\"[^\"]+\"/, 'network_mode = "default"');
          out = out.replace(/\bmemory_mb\s*=\s*[0-9]+/, "memory_mb = 2048");
          return out;
        }
      );

      configText = configText.replace(
        /\[app\.bash_tools\.sandbox\][\s\S]*?(?=\n\[|$)/,
        (block) => {
          let out = block;
          out = out.replace(/\bruntime\s*=\s*\"[^\"]+\"/, 'runtime = "node24"');
          out = out.replace(/\bports\s*=\s*\[[^\]]*\]/, "ports = []");
          return out;
        }
      );
    }

    configText = configText.replace(
      /\[app\.bash_tools\.seed\][\s\S]*?(?=\n\[|$)/,
      (block) => {
        let out = block;
        out = out.replace(/\bmode\s*=\s*\"[^\"]+\"/, 'mode = "upload"');
        out = out.replace(/\bupload_include\s*=\s*\"[^\"]*\"/, 'upload_include = "**/*.nope"');
        return out;
      }
    );
  }

  fs.writeFileSync(configPath, `${configText}\n\n${extra}`);
} catch (err) {
  console.error("Failed to prepare E2E config file:", err);
  process.exit(1);
}
