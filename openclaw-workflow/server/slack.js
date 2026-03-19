const { App, ExpressReceiver, LogLevel } = require("@slack/bolt");
const { WebClient } = require("@slack/web-api");
const { runAgent } = require("./agents");

const AGENT_TOKENS = {
  manager: () => process.env.SLACK_TOKEN_ALEX,
  pm:      () => process.env.SLACK_TOKEN_EMMA,
  dev:     () => process.env.SLACK_TOKEN_JAMES,
};

let receiver;
let app;
let agentClients = {};

function createSlackApp(expressApp) {
  receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    endpoints: "/slack/events",
    app: expressApp,
  });

  // Alex is the main bot that receives events
  app = new App({
    token: process.env.SLACK_TOKEN_ALEX,
    receiver,
  });

  // Create separate WebClients for Emma and James
  agentClients = {
    manager: new WebClient(process.env.SLACK_TOKEN_ALEX),
    pm:      new WebClient(process.env.SLACK_TOKEN_EMMA),
    dev:     new WebClient(process.env.SLACK_TOKEN_JAMES),
  };

  const DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL || "C0AMF4G23PF";

  // Handle @mentions
  app.event("app_mention", async ({ event }) => {
    console.log(`[slack] app_mention from ${event.user}: ${event.text}`);
    try {
      await runAgent("manager", event.text, {
        onMessage: (agentKey, text) => postAsAgent(event.channel, agentKey, text),
      });
    } catch (err) {
      console.error("[slack] agent error:", err);
      await postAsAgent(event.channel, "manager", `오류가 발생했습니다: ${err.message}`);
    }
  });

  // Handle DMs
  app.event("message", async ({ event }) => {
    // Skip bot messages and threaded replies to avoid loops
    if (event.bot_id || event.subtype || event.thread_ts) return;
    // Only respond in DMs (channel type "im")
    if (event.channel_type !== "im") return;

    console.log(`[slack] DM from ${event.user}: ${event.text}`);
    try {
      await runAgent("manager", event.text, {
        onMessage: (agentKey, text) => postAsAgent(event.channel, agentKey, text),
      });
    } catch (err) {
      console.error("[slack] agent error:", err);
      await postAsAgent(event.channel, "manager", `오류가 발생했습니다: ${err.message}`);
    }
  });

  return { app, receiver, DEFAULT_CHANNEL };
}

async function postToSlack(channel, text) {
  const client = agentClients.manager;
  if (!client) {
    console.warn("[slack] not initialized, skipping postToSlack");
    return;
  }
  try {
    await client.chat.postMessage({ channel, text });
  } catch (err) {
    console.error("[slack] postToSlack error:", err.message);
  }
}

async function postAsAgent(channel, agentKey, text) {
  const client = agentClients[agentKey] || agentClients.manager;
  if (!client) {
    console.warn("[slack] not initialized, skipping postAsAgent");
    return;
  }
  try {
    await client.chat.postMessage({ channel, text });
  } catch (err) {
    console.error("[slack] postAsAgent error:", err.message);
  }
}

module.exports = { createSlackApp, postToSlack, postAsAgent };
