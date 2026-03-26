require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const express = require("express");
const { runAgent } = require("./agents");
const { createSlackApp, postToSlack, postAsAgent } = require("./slack");
const { readRepos } = require("./repos");
const { updateTaskStatus, makeTaskId } = require("./wbs");
const { startCron } = require("./cron");

const PORT = process.env.PORT || 45555;
const app = express();

// Initialize Slack BEFORE express.json() so receiver can read raw body
const { DEFAULT_CHANNEL } = createSlackApp(app);

// Parse JSON for all routes except /slack/events (handled by Slack receiver)
app.use((req, res, next) => {
  if (req.path === "/slack/events") return next();
  express.json()(req, res, next);
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Track recently created issues to skip duplicate assigned events
const recentlyCreatedIssues = new Map(); // key: "repo#issue_number" → timestamp

// GitHub webhook endpoint (receives summarized events from relay)
app.post("/hooks/github", async (req, res) => {
  const payload = req.body;
  console.log(`[server] received github hook: ${payload.event} — ${payload.summary}`);

  // Skip unregistered repositories — no API call, no Slack message
  try {
    const repos = await readRepos();
    const registered = repos.repositories.some((r) => r.github === payload.repository);
    if (!registered) {
      console.log(`[server] ignoring unregistered repo: ${payload.repository}`);
      return res.json({ status: "ignored", reason: "unregistered repository" });
    }
  } catch (err) {
    console.error("[server] repo check error:", err);
  }

  // Skip assigned/unassigned events that arrive right after opened (within 30s)
  // These are already handled in the opened event
  if (payload.event === "issues" && (payload.action === "assigned" || payload.action === "unassigned")) {
    const issueKey = `${payload.repository}#${payload.issue_number}`;
    const createdAt = recentlyCreatedIssues.get(issueKey);
    if (createdAt && Date.now() - createdAt < 30000) {
      console.log(`[server] skipping ${payload.action} for ${issueKey} — already handled in opened`);
      return res.json({ status: "skipped", reason: "handled in opened event" });
    }
  }

  try {
    const userMessage = JSON.stringify(payload);

    // Route to appropriate agent based on event type
    // Issue opened → Emma (PM) analyzes, then James (Dev) creates task
    // All other events → James (Dev) handles directly
    let agentName = "dev";
    if (payload.event === "issues" && payload.action === "opened") {
      agentName = "pm";
    }

    const result = await runAgent(agentName, userMessage, {
      onMessage: (agentKey, text) => postAsAgent(DEFAULT_CHANNEL, agentKey, text),
    });
    const logs = result._logs || [];

    // For new issues, also run dev agent to create the task
    if (payload.event === "issues" && payload.action === "opened") {
      const devResult = await runAgent("dev", userMessage, {
        onMessage: (agentKey, text) => postAsAgent(DEFAULT_CHANNEL, agentKey, text),
      });
      logs.push(...(devResult._logs || []));

      // Mark this issue as recently created
      const issueKey = `${payload.repository}#${payload.issue_number}`;
      recentlyCreatedIssues.set(issueKey, Date.now());
      // Clean up after 60s
      setTimeout(() => recentlyCreatedIssues.delete(issueKey), 60000);
    }

    res.json({ status: "processed", logs });
  } catch (err) {
    console.error("[server] github hook error:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Direct task status update endpoint (called from git hooks)
app.post("/hooks/task-status", async (req, res) => {
  const { issue_number, repository, status, branch } = req.body;
  console.log(`[server] task-status: ${repository}#${issue_number} → ${status}`);

  if (!issue_number || !repository || !status) {
    return res.status(400).json({ status: "error", error: "issue_number, repository, status required" });
  }

  try {
    const taskId = makeTaskId(issue_number, repository);
    const extra = {};
    if (branch) extra.branch = branch;

    const result = await updateTaskStatus(taskId, status, extra);
    if (result.ok) {
      // Notify Slack
      await postAsAgent(DEFAULT_CHANNEL, "dev", `${repository} #${issue_number} → ${status} (branch: ${branch || "N/A"})`);
      res.json({ status: "updated", task: result.task });
    } else {
      console.log(`[server] task-status skip: ${result.error}`);
      res.json({ status: "skipped", reason: result.error });
    }
  } catch (err) {
    console.error("[server] task-status error:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Start cron
startCron(DEFAULT_CHANNEL);

// Boot
app.listen(PORT, () => {
  console.log(`[server] OpenClaw main server listening on :${PORT}`);
});
