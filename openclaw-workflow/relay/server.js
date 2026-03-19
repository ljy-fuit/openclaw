require("dotenv").config();
const express = require("express");

const app = express();
const PORT = process.env.RELAY_PORT || 3001;
const OPENCLAW_HOOK_URL =
  process.env.OPENCLAW_HOOK_URL || "http://localhost:45555/hooks/github";
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN || "";

app.use(express.json());

function summarizePush(payload) {
  const repo = payload.repository?.full_name || "unknown/repo";
  const branch = (payload.ref || "").replace("refs/heads/", "");
  const commits = (payload.commits || []).map((c) => ({
    id: c.id?.substring(0, 7),
    message: c.message?.split("\n")[0],
    author: c.author?.username || c.author?.name,
  }));

  const taskIds = [];
  for (const c of payload.commits || []) {
    const matches = c.message?.match(/TASK-\d+/g);
    if (matches) taskIds.push(...matches);
  }

  return {
    event: "push",
    repository: repo,
    branch,
    commits,
    task_ids: [...new Set(taskIds)],
    summary: `${commits.length} commit(s) pushed to ${repo}/${branch}`,
  };
}

function summarizePullRequest(payload) {
  const repo = payload.repository?.full_name || "unknown/repo";
  const pr = payload.pull_request || {};
  const action = payload.action;

  const taskIds = [];
  const titleMatches = pr.title?.match(/TASK-\d+/g);
  const bodyMatches = pr.body?.match(/TASK-\d+/g);
  const branchMatches = pr.head?.ref?.match(/TASK-\d+/g);
  if (titleMatches) taskIds.push(...titleMatches);
  if (bodyMatches) taskIds.push(...bodyMatches);
  if (branchMatches) taskIds.push(...branchMatches);

  return {
    event: "pull_request",
    action,
    repository: repo,
    pr_number: pr.number,
    pr_title: pr.title,
    pr_url: pr.html_url,
    branch: pr.head?.ref,
    merged: pr.merged || false,
    task_ids: [...new Set(taskIds)],
    summary: `PR #${pr.number} ${action}: ${pr.title}`,
  };
}

async function forwardToOpenClaw(data) {
  const headers = { "Content-Type": "application/json" };
  if (OPENCLAW_HOOK_TOKEN) {
    headers["Authorization"] = `Bearer ${OPENCLAW_HOOK_TOKEN}`;
  }

  try {
    const res = await fetch(OPENCLAW_HOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
    console.log(
      `[relay] forwarded to OpenClaw: ${res.status} ${res.statusText}`
    );
    return { status: res.status, ok: res.ok };
  } catch (err) {
    console.error(`[relay] forward failed: ${err.message}`);
    return { status: 502, ok: false, error: err.message };
  }
}

app.post("/github", async (req, res) => {
  const event = req.headers["x-github-event"];
  console.log(`[relay] received github event: ${event}`);

  let summary;
  switch (event) {
    case "push":
      summary = summarizePush(req.body);
      break;
    case "pull_request":
      summary = summarizePullRequest(req.body);
      break;
    default:
      console.log(`[relay] ignoring event: ${event}`);
      return res.json({ status: "ignored", event });
  }

  console.log(`[relay] summary:`, JSON.stringify(summary, null, 2));

  const result = await forwardToOpenClaw(summary);
  res.json({ status: "forwarded", summary, relay_result: result });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`[relay] GitHub webhook relay listening on :${PORT}`);
  console.log(`[relay] forwarding to: ${OPENCLAW_HOOK_URL}`);
});
