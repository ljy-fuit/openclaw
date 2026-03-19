const fs = require("fs");
const path = require("path");
const lockfile = require("proper-lockfile");

const REPOS_PATH = path.resolve(__dirname, "..", "data", "repositories.json");

async function readRepos() {
  const raw = await fs.promises.readFile(REPOS_PATH, "utf-8");
  return JSON.parse(raw);
}

async function writeRepos(data) {
  data.updated_at = new Date().toISOString();
  let release;
  try {
    release = await lockfile.lock(REPOS_PATH, { retries: 3 });
    await fs.promises.writeFile(REPOS_PATH, JSON.stringify(data, null, 2), "utf-8");
  } finally {
    if (release) await release();
  }
}

async function addRepos(newRepos) {
  const data = await readRepos();
  const added = [];

  for (const r of newRepos) {
    // Skip if already registered
    const exists = data.repositories.find(
      (existing) => existing.github === r.github
    );
    if (exists) continue;

    const repo = {
      name: r.name,
      github: r.github,
      description: r.description || "",
      labels: r.labels || [],
    };
    data.repositories.push(repo);
    added.push(repo);
  }

  if (added.length > 0) {
    await writeRepos(data);
  }
  return added;
}

async function removeRepo(github) {
  const data = await readRepos();
  const idx = data.repositories.findIndex((r) => r.github === github);
  if (idx === -1) return { ok: false, error: `Repository ${github} not found` };

  const removed = data.repositories.splice(idx, 1)[0];
  await writeRepos(data);
  return { ok: true, removed };
}

module.exports = { readRepos, writeRepos, addRepos, removeRepo };
