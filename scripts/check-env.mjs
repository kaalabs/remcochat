const key =
  process.env.VERCEL_AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_API_KEY;

if (!key) {
  console.error(
    [
      "Missing Vercel AI Gateway API key.",
      "",
      "Export it in your shell before running RemcoChat:",
      "  export VERCEL_AI_GATEWAY_API_KEY='...'",
      "",
      "Alternative (also supported):",
      "  export AI_GATEWAY_API_KEY='...'",
    ].join("\n")
  );
  process.exit(1);
}

