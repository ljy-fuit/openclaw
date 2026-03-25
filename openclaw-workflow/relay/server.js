require("dotenv").config();
const express = require("express");

const app = express();
const PORT = process.env.RELAY_PORT || 3001;
const OPENCLAW_HOOK_URL =
  process.env.OPENCLAW_HOOK_URL || "http://localhost:45555/hooks/github";
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN || "";

app.use(express.json());

function extractIssueNumbers(text) {
  if (!text) return [];
  const matches = text.match(/#(\d+)/g);
  return matches ? matches.map((m) => parseInt(m.replace("#", ""), 10)) : [];
}

function summarizePush(payload) {
  const repo = payload.repository?.full_name || "unknown/repo";
  const branch = (payload.ref || "").replace("refs/heads/", "");
  const commits = (payload.commits || []).map((c) => ({
    id: c.id?.substring(0, 7),
    message: c.message?.split("\n")[0],
    author: c.author?.username || c.author?.name,
  }));

  const issueNumbers = [];
  for (const c of payload.commits || []) {
    issueNumbers.push(...extractIssueNumbers(c.message));
  }
  // Also extract from branch name (e.g. feature/42-description, fix/15-bug)
  const branchNumbers = branch.match(/(?:^|\/)(\d+)(?:-|$)/);
  if (branchNumbers) issueNumbers.push(parseInt(branchNumbers[1], 10));

  return {
    event: "push",
    repository: repo,
    branch,
    commits,
    issue_numbers: [...new Set(issueNumbers)],
    summary: `${commits.length} commit(s) pushed to ${repo}/${branch}`,
  };
}

function summarizePullRequest(payload) {
  const repo = payload.repository?.full_name || "unknown/repo";
  const pr = payload.pull_request || {};
  const action = payload.action;

  const issueNumbers = [
    ...extractIssueNumbers(pr.title),
    ...extractIssueNumbers(pr.body),
    ...extractIssueNumbers(pr.head?.ref),
  ];
  // Also extract from branch name pattern (e.g. feature/42-description)
  const branchNumbers = pr.head?.ref?.match(/(?:^|\/)(\d+)(?:-|$)/);
  if (branchNumbers) issueNumbers.push(parseInt(branchNumbers[1], 10));

  return {
    event: "pull_request",
    action,
    repository: repo,
    pr_number: pr.number,
    pr_title: pr.title,
    pr_url: pr.html_url,
    branch: pr.head?.ref,
    merged: pr.merged || false,
    issue_numbers: [...new Set(issueNumbers)],
    summary: `PR #${pr.number} ${action}: ${pr.title}`,
  };
}

function summarizeIssues(payload) {
  const repo = payload.repository?.full_name || "unknown/repo";
  const issue = payload.issue || {};
  const action = payload.action;

  return {
    event: "issues",
    action,
    repository: repo,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_url: issue.html_url,
    issue_body: issue.body || "",
    issue_labels: (issue.labels || []).map((l) => l.name),
    assignee: issue.assignee?.login || null,
    assignees: (issue.assignees || []).map((a) => a.login),
    summary: `Issue #${issue.number} ${action}: ${issue.title}`,
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
    case "issues": {
      const VALID_ACTIONS = ["opened", "assigned", "unassigned", "closed", "reopened"];
      const action = req.body.action;
      if (!VALID_ACTIONS.includes(action)) {
        console.log(`[relay] ignoring issues action: ${action}`);
        return res.json({ status: "ignored", event, action });
      }
      summary = summarizeIssues(req.body);
      break;
    }
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
