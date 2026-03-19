require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const express = require("express");
const { runAgent } = require("./agents");
const { createSlackApp, postToSlack } = require("./slack");
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

  try {
    const userMessage = JSON.stringify(payload);
    const result = await runAgent("dev", userMessage);
    const logs = result._logs || [];

    // Notify Slack
    const slackMessage =
      `*[GitHub ${payload.event}]* ${payload.summary}\n` +
      (result.reply || "") +
      (logs.length ? `\n_${logs.join(", ")}_` : "");

    await postToSlack(DEFAULT_CHANNEL, slackMessage);

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
