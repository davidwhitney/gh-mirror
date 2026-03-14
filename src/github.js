const HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function paginate(token, baseUrl) {
  const repos = [];
  let page = 1;

  while (true) {
    const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}per_page=100&page=${page}`;
    const res = await fetch(url, { headers: HEADERS(token) });

    if (res.status === 401) {
      throw new Error(
        "GitHub API authentication failed. Your token may be expired or invalid.\n" +
          "Create a new token at https://github.com/settings/tokens"
      );
    }

    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API error (${res.status}): ${body}`);
    }

    const data = await res.json();
    if (data.length === 0) break;

    repos.push(...data.map((r) => ({ name: r.name, cloneUrl: r.clone_url, sshUrl: r.ssh_url, archived: r.archived, pushedAt: r.pushed_at })));
    page++;
  }

  return repos;
}

export async function listRepos(token, owner) {
  const encoded = encodeURIComponent(owner);

  // Try as an org first
  const orgRepos = await paginate(token, `https://api.github.com/orgs/${encoded}/repos`);
  if (orgRepos !== null) return orgRepos;

  // Fall back to user repos
  const userRepos = await paginate(token, `https://api.github.com/users/${encoded}/repos`);
  if (userRepos !== null) return userRepos;

  throw new Error(
    `"${owner}" not found as an organisation or user. Check the name and ensure your token has access.`
  );
}
