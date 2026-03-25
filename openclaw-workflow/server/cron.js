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
          "오늘의 데일리 브리핑을 작성해줘. 멤버별로 진행 중인 태스크를 slack_display 태그로 정리하고, 미배정 태스크와 전체 현황도 포함해줘."
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

  // Weekly briefing at 09:00 Monday Asia/Seoul
  cron.schedule(
    "0 9 * * 1",
    async () => {
      console.log("[cron] running weekly briefing...");
      try {
        const result = await runAgent(
          "manager",
          "이번 주 주간보고를 작성해줘. 지난주 완료 태스크, 이번 주 멤버별 진행 예정 태스크, 블로커를 slack_display 태그로 정리해줘."
        );
        await postToSlack(defaultChannel, result.reply || "주간 브리핑을 생성할 수 없습니다.");
        console.log("[cron] weekly briefing posted");
      } catch (err) {
        console.error("[cron] weekly briefing error:", err);
        await postToSlack(
          defaultChannel,
          `주간 브리핑 오류: ${err.message}`
        );
      }
    },
    { timezone: "Asia/Seoul" }
  );

  console.log("[cron] weekly briefing scheduled at 09:00 Monday Asia/Seoul");
}

module.exports = { startCron };
