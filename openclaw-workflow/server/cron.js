const cron = require("node-cron");
const { runAgent } = require("./agents");
const { postToSlack } = require("./slack");

function startCron(defaultChannel) {
  // Daily briefing at 09:00 Asia/Seoul
  cron.schedule(
    "0 9 * * *",
    async () => {
      console.log("[cron] running daily briefing...");
      try {
        const result = await runAgent(
          "manager",
          "Read data/wbs.json and post today's work summary to Slack. Include: tasks by status, blockers, and priorities for today."
        );
        await postToSlack(defaultChannel, result.reply || "데일리 브리핑을 생성할 수 없습니다.");
        console.log("[cron] daily briefing posted");
      } catch (err) {
        console.error("[cron] daily briefing error:", err);
        await postToSlack(
          defaultChannel,
          `데일리 브리핑 오류: ${err.message}`
        );
      }
    },
    { timezone: "Asia/Seoul" }
  );

  console.log("[cron] daily briefing scheduled at 09:00 Asia/Seoul");
}

module.exports = { startCron };
