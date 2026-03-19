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
          "오늘의 데일리 브리핑을 작성해줘. 포함할 내용: 각 멤버별 오늘 할 일(프로젝트별로 그룹핑), 전체 태스크 현황, 블로커, 미배정 태스크."
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
          "이번 주 주간 브리핑을 작성해줘. 포함할 내용: 지난주 완료된 태스크, 이번 주 각 멤버별/프로젝트별 할 일, 블로커나 지연된 태스크."
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
