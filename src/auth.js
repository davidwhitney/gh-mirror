export function getToken(cliToken) {
  const token = cliToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error(
      `No GitHub token found. Provide one via:\n` +
        `  --token <pat>           CLI flag\n` +
        `  GITHUB_TOKEN=<pat>      environment variable\n` +
        `  GH_TOKEN=<pat>          environment variable (GitHub CLI compatible)\n\n` +
        `Create a token at https://github.com/settings/tokens\n` +
        `Required scopes: repo (for private repos) or public_repo (for public only)`
    );
  }
  return token;
}
