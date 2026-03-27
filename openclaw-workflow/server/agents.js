const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { readWbs, updateTaskStatus, updateTaskFields, addTasks } = require("./wbs");
const { readRepos, addRepos, removeRepo } = require("./repos");
const { readMembers, addMember, updateMember, removeMember, assignToProject, unassignFromProject } = require("./members");

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
  "tasks_to_add": [{ "title": "...", "description": "...", "priority": "high|medium|low", "repository": "owner/repo", "issue_number": 42, "issue_url": "https://github.com/...", "labels": [], "depends_on": [], "assignee": "member name or null" }],
  "tasks_to_update": [{ "id": "owner/repo#42", "status": "todo|in_progress|in_review|done", "assignee": "member name or null", "branch": "branch-name", "pr": 123 }],
  "repos_to_add": [{ "name": "프로젝트명-역할", "github": "owner/repo-name", "description": "설명", "labels": ["backend|frontend|mobile|etc"] }],
  "repos_to_remove": ["owner/repo-name"],
  "members_to_add": [{ "name": "이름", "name_en": "english_name", "slack_display": "@slack_name", "github": "github_username", "role": "backend_dev|frontend_dev|designer|mobile_dev|fullstack_dev|devops|pm|qa", "skills": [] }],
  "members_to_remove": ["MEM-XXX 또는 이름"],
  "project_assignments": [{ "member_name": "이름", "repository": "owner/repo", "project_name": "프로젝트명", "role_in_project": "역할" }],
  "project_unassignments": [{ "member_name": "이름", "repository": "owner/repo" }]
}
`;

async function callAgent(agentName, userMessage) {
  const wbs = await readWbs();
  const repos = await readRepos();
  const members = await readMembers();
  const wbsContext = `\n\nCurrent WBS (data/wbs.json):\n${JSON.stringify(wbs, null, 2)}`;
  const reposContext = `\n\nRegistered Repositories (data/repositories.json):\n${JSON.stringify(repos, null, 2)}`;
  const membersContext = `\n\nRegistered Members (data/members.json):\n${JSON.stringify(members, null, 2)}`;

  const systemPrompt =
    (SYSTEM_PROMPTS[agentName] || SYSTEM_PROMPTS.manager) +
    reposContext +
    membersContext +
    wbsContext +
    "\n\n" +
    RESPONSE_SCHEMA;

  console.log(`[agents] calling ${agentName} agent via CLI...`);

  const text = await new Promise((resolve, reject) => {
    const proc = spawn("/root/.nvm/versions/node/v18.20.5/bin/claude", [
      "-p",
      "--output-format", "text",
      "--model", "sonnet",
    ], {
      env: { ...process.env },
      timeout: 120000,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`claude CLI exit ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });

    // Pass system prompt + user message via stdin
    proc.stdin.write(systemPrompt);
    proc.stdin.write("\n\n---\n\nUser message:\n");
    proc.stdin.write(userMessage);
    proc.stdin.end();
  });

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

  // Apply member additions
  if (result.members_to_add && result.members_to_add.length > 0) {
    for (const m of result.members_to_add) {
      const res = await addMember(m);
      if (res.ok) {
        logs.push(`Registered member: ${res.member.name} (${res.member.id})`);
      } else {
        logs.push(`Member already exists: ${res.error}`);
      }
    }
  }

  // Apply member removals
  if (result.members_to_remove && result.members_to_remove.length > 0) {
    for (const id of result.members_to_remove) {
      const res = await removeMember(id);
      if (res.ok) {
        logs.push(`Removed member: ${res.removed.name}`);
      } else {
        logs.push(`Failed to remove member: ${res.error}`);
      }
    }
  }

  // Apply project assignments
  if (result.project_assignments && result.project_assignments.length > 0) {
    for (const a of result.project_assignments) {
      const res = await assignToProject(a.member_name, {
        repository: a.repository,
        project_name: a.project_name,
        role_in_project: a.role_in_project,
      });
      if (res.ok) {
        logs.push(`Assigned ${a.member_name} to ${a.project_name || a.repository}`);
      } else {
        logs.push(`Failed to assign: ${res.error}`);
      }
    }
  }

  // Apply project unassignments
  if (result.project_unassignments && result.project_unassignments.length > 0) {
    for (const u of result.project_unassignments) {
      const res = await unassignFromProject(u.member_name, u.repository);
      if (res.ok) {
        logs.push(`Unassigned ${u.member_name} from ${u.repository}`);
      } else {
        logs.push(`Failed to unassign: ${res.error}`);
      }
    }
  }

  // Apply task updates
  if (result.tasks_to_update && result.tasks_to_update.length > 0) {
    for (const u of result.tasks_to_update) {
      const extra = {};
      if (u.branch) extra.branch = u.branch;
      if (u.pr) extra.pr = u.pr;
      if (u.assignee !== undefined) extra.assignee = u.assignee;

      // If no status change, just update fields (e.g. assignee only)
      if (!u.status) {
        const res = await updateTaskFields(u.id, extra);
        if (res.ok) {
          logs.push(`Updated ${u.id} fields`);
        } else {
          logs.push(`Failed to update ${u.id}: ${res.error}`);
        }
      } else {
        const res = await updateTaskStatus(u.id, u.status, extra);
        if (res.ok) {
          logs.push(`Updated ${u.id} → ${u.status}`);
        } else {
          logs.push(`Failed to update ${u.id}: ${res.error}`);
        }
      }
    }
  }

  return logs;
}

const AGENT_NAMES = {
  manager: "Alex",
  pm: "Emma",
  dev: "James",
};

async function runAgent(agentName, userMessage, options = {}) {
  const { depth = 0, onMessage } = options;
  const MAX_DEPTH = 2;
  const displayName = AGENT_NAMES[agentName] || agentName;

  const result = await callAgent(agentName, userMessage);
  const logs = await applyAgentActions(result);

  // Post this agent's reply to Slack
  if (onMessage && result.reply) {
    await onMessage(agentName, result.reply);
  }

  // Handle delegation (max 2 hops)
  if (result.delegate_to && depth < MAX_DEPTH) {
    const targetName = AGENT_NAMES[result.delegate_to] || result.delegate_to;
    console.log(
      `[agents] ${agentName} delegating to ${result.delegate_to} (depth=${depth + 1})`
    );

    // Post delegation message to Slack
    if (onMessage) {
      await onMessage(agentName, `→ _${targetName}에게 요청합니다..._`);
    }

    const delegateResult = await runAgent(
      result.delegate_to,
      result.delegate_message || userMessage,
      { depth: depth + 1, onMessage }
    );

    // Merge for final result (for non-Slack callers like cron/webhook)
    result.reply =
      (result.reply || "") +
      "\n\n---\n" +
      `*[${targetName}]:*\n` +
      (delegateResult.reply || "");
    logs.push(...(delegateResult._logs || []));
  }

  result._logs = logs;
  return result;
}

module.exports = { runAgent, callAgent, applyAgentActions };
