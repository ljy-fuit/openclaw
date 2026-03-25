require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const express = require("express");
const { runAgent } = require("./agents");
const { createSlackApp, postToSlack, postAsAgent } = require("./slack");
const { readRepos } = require("./repos");
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
    }

    res.json({ status: "processed", logs });
  } catch (err) {
    console.error("[server] github hook error:", err);
    res.status(500).json({ status: "error", error: err.message });
  }
});

// Start cron
startCron(DEFAULT_CHANNEL);

// Boot
app.listen(PORT, () => {
  console.log(`[server] OpenClaw main server listening on :${PORT}`);
});
