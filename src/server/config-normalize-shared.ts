export function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  return Math.min(max, Math.max(min, Math.floor(Number(value ?? fallback))));
}

export function uniqueTrimmedStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value).trim())
        .filter(Boolean)
    )
  );
}

export function normalizeServiceBaseUrls(
  rawBaseUrls: unknown,
  defaultBaseUrls: string[],
  options: {
    configPath: string;
    keepPath: boolean;
  }
): string[] {
  const baseUrlsRaw = Array.isArray(rawBaseUrls)
    ? rawBaseUrls.map((url) => String(url).trim()).filter(Boolean)
    : [];
  const baseUrlsInput = baseUrlsRaw.length > 0 ? baseUrlsRaw : defaultBaseUrls;

  const seenBaseUrls = new Set<string>();
  const baseUrls: string[] = [];
  for (const rawUrl of baseUrlsInput) {
    const trimmed = String(rawUrl ?? "").trim().replace(/\/+$/, "");
    if (!trimmed) {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(
        `config.toml: ${options.configPath}.base_urls contains an invalid URL: ${JSON.stringify(trimmed)}`
      );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `config.toml: ${options.configPath}.base_urls must use http(s): ${JSON.stringify(trimmed)}`
      );
    }
    if (parsed.username || parsed.password) {
      throw new Error(
        `config.toml: ${options.configPath}.base_urls must not include credentials: ${JSON.stringify(trimmed)}`
      );
    }
    if (parsed.search || parsed.hash) {
      throw new Error(
        `config.toml: ${options.configPath}.base_urls must not include a query/hash: ${JSON.stringify(trimmed)}`
      );
    }
    if (!options.keepPath && parsed.pathname && parsed.pathname !== "/") {
      throw new Error(
        `config.toml: ${options.configPath}.base_urls must not include a path: ${JSON.stringify(trimmed)}`
      );
    }

    const normalized = options.keepPath
      ? `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "")
      : `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
    if (!normalized || seenBaseUrls.has(normalized)) {
      continue;
    }
    seenBaseUrls.add(normalized);
    baseUrls.push(normalized);
  }

  if (baseUrls.length === 0) {
    throw new Error(
      `config.toml: ${options.configPath}.base_urls must include at least one base URL`
    );
  }

  return baseUrls;
}
