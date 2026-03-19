const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { readWbs, updateTaskStatus, addTasks } = require("./wbs");
const { readRepos, addRepos, removeRepo } = require("./repos");

const client = new Anthropic();

const PROMPTS_DIR = path.resolve(__dirname, "..", "prompts");

function loadPrompt(filename) {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8");
}

const SYSTEM_PROMPTS = {
  manager: loadPrompt("manager.md"),
  pm: loadPrompt("pm.md"),
  dev: loadPrompt("dev.md"),
};

const RESPONSE_SCHEMA = `
You MUST respond with valid JSON only. No markdown fences, no extra text.
Schema:
{
  "action": "status_report|add_tasks|update_tasks|delegate|tech_spec",
  "reply": "Human-readable message to post in Slack",
  "delegate_to": null | "pm" | "dev",
  "delegate_message": "Message to pass to the delegated agent (null if not delegating)",
  "tasks_to_add": [{ "title": "...", "description": "...", "priority": "high|medium|low", "repository": "owner/repo", "labels": [], "depends_on": [] }],
  "tasks_to_update": [{ "id": "TASK-XXX", "status": "todo|in_progress|in_review|done" }],
  "repos_to_add": [{ "name": "프로젝트명-역할", "github": "owner/repo-name", "description": "설명", "labels": ["backend|frontend|mobile|etc"] }],
  "repos_to_remove": ["owner/repo-name"]
}
`;

async function callAgent(agentName, userMessage) {
  const wbs = await readWbs();
  const repos = await readRepos();
  const wbsContext = `\n\nCurrent WBS (data/wbs.json):\n${JSON.stringify(wbs, null, 2)}`;
  const reposContext = `\n\nRegistered Repositories (data/repositories.json):\n${JSON.stringify(repos, null, 2)}`;

  const systemPrompt =
    (SYSTEM_PROMPTS[agentName] || SYSTEM_PROMPTS.manager) +
    reposContext +
    wbsContext +
    "\n\n" +
    RESPONSE_SCHEMA;

  console.log(`[agents] calling ${agentName} agent...`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed;
  try {
    // Strip markdown fences if the model wraps them anyway
    const cleaned = text.replace(/^```json?\s*/m, "").replace(/```\s*$/m, "");
    parsed = JSON.parse(cleaned);
  } catch {
    console.error(`[agents] ${agentName} returned non-JSON:`, text);
    parsed = {
      action: "status_report",
      reply: text,
      delegate_to: null,
      delegate_message: null,
      tasks_to_add: [],
      tasks_to_update: [],
    };
  }

  return parsed;
}

async function applyAgentActions(result) {
  const logs = [];

  // Apply task additions
  if (result.tasks_to_add && result.tasks_to_add.length > 0) {
    const added = await addTasks(result.tasks_to_add);
    logs.push(`Added ${added.length} task(s): ${added.map((t) => t.id).join(", ")}`);
  }

  // Apply repo additions
  if (result.repos_to_add && result.repos_to_add.length > 0) {
    const added = await addRepos(result.repos_to_add);
    if (added.length > 0) {
      logs.push(`Registered ${added.length} repo(s): ${added.map((r) => r.github).join(", ")}`);
    }
  }

  // Apply repo removals
  if (result.repos_to_remove && result.repos_to_remove.length > 0) {
    for (const github of result.repos_to_remove) {
      const res = await removeRepo(github);
      if (res.ok) {
        logs.push(`Removed repo: ${github}`);
      } else {
        logs.push(`Failed to remove repo: ${res.error}`);
      }
    }
  }

  // Apply task updates
  if (result.tasks_to_update && result.tasks_to_update.length > 0) {
    for (const u of result.tasks_to_update) {
      const extra = {};
      if (u.branch) extra.branch = u.branch;
      if (u.pr) extra.pr = u.pr;
      const res = await updateTaskStatus(u.id, u.status, extra);
      if (res.ok) {
        logs.push(`Updated ${u.id} → ${u.status}`);
      } else {
        logs.push(`Failed to update ${u.id}: ${res.error}`);
      }
    }
  }

  return logs;
}

async function runAgent(agentName, userMessage, depth = 0) {
  const MAX_DEPTH = 2;
  const result = await callAgent(agentName, userMessage);
  const logs = await applyAgentActions(result);

  // Handle delegation (max 2 hops)
  if (result.delegate_to && depth < MAX_DEPTH) {
    console.log(
      `[agents] ${agentName} delegating to ${result.delegate_to} (depth=${depth + 1})`
    );
    const delegateResult = await runAgent(
      result.delegate_to,
      result.delegate_message || userMessage,
      depth + 1
    );
    // Merge replies
    result.reply =
      (result.reply || "") +
      "\n\n---\n" +
      `*[${result.delegate_to} agent]:*\n` +
      (delegateResult.reply || "");
    logs.push(...(delegateResult._logs || []));
  }

  result._logs = logs;
  return result;
}

module.exports = { runAgent, callAgent, applyAgentActions };
