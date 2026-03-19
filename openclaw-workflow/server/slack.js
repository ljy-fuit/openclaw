const { App, ExpressReceiver } = require("@slack/bolt");
const { runAgent } = require("./agents");

let receiver;
let app;

function createSlackApp(expressApp) {
  receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    endpoints: "/slack/events",
    app: expressApp,
  });

  app = new App({
    token: process.env.OPENCLAW_SLACK_TOKEN,
    receiver,
  });

  const DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL || "C0AMF4G23PF";

  // Handle @mentions
  app.event("app_mention", async ({ event, say }) => {
    console.log(`[slack] app_mention from ${event.user}: ${event.text}`);
    try {
      const result = await runAgent("manager", event.text);
      await say({ text: result.reply || "처리 완료", thread_ts: event.ts });
    } catch (err) {
      console.error("[slack] agent error:", err);
      await say({
        text: `오류가 발생했습니다: ${err.message}`,
        thread_ts: event.ts,
      });
    }
  });

  // Handle DMs
  app.event("message", async ({ event, say }) => {
    // Skip bot messages and threaded replies to avoid loops
    if (event.bot_id || event.subtype || event.thread_ts) return;
    // Only respond in DMs (channel type "im")
    if (event.channel_type !== "im") return;

    console.log(`[slack] DM from ${event.user}: ${event.text}`);
    try {
      const result = await runAgent("manager", event.text);
      await say({ text: result.reply || "처리 완료" });
    } catch (err) {
      console.error("[slack] agent error:", err);
      await say({ text: `오류가 발생했습니다: ${err.message}` });
    }
  });

  return { app, receiver, DEFAULT_CHANNEL };
}

async function postToSlack(channel, text) {
  if (!app) {
    console.warn("[slack] app not initialized, skipping postToSlack");
    return;
  }
  try {
    await app.client.chat.postMessage({
      token: process.env.OPENCLAW_SLACK_TOKEN,
      channel,
      text,
    });
  } catch (err) {
    console.error("[slack] postToSlack error:", err.message);
  }
}

module.exports = { createSlackApp, postToSlack };
