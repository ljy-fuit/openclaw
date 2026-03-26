const fs = require("fs");
const path = require("path");
const lockfile = require("proper-lockfile");

const WBS_PATH = path.resolve(__dirname, "..", "data", "wbs.json");

const VALID_TRANSITIONS = {
  todo: ["in_progress", "done"],
  in_progress: ["in_review", "done"],
  in_review: ["done", "in_progress"],
  done: ["todo"],
};

async function readWbs() {
  const raw = await fs.promises.readFile(WBS_PATH, "utf-8");
  return JSON.parse(raw);
}

async function writeWbs(wbs) {
  wbs.updated_at = new Date().toISOString();
  let release;
  try {
    release = await lockfile.lock(WBS_PATH, { retries: 3 });
    await fs.promises.writeFile(WBS_PATH, JSON.stringify(wbs, null, 2), "utf-8");
  } finally {
    if (release) await release();
  }
}

function makeTaskId(issueNumber, repo) {
  return `${repo}#${issueNumber}`;
}

function findTaskByIssue(wbs, issueNumber, repo) {
  return wbs.tasks.find(
    (t) => t.issue_number === issueNumber && t.repository === repo
  );
}

function validateTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

async function updateTaskStatus(taskId, newStatus, extra = {}) {
  const wbs = await readWbs();
  const task = wbs.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, error: `Task ${taskId} not found` };

  if (!validateTransition(task.status, newStatus)) {
    return {
      ok: false,
      error: `Invalid transition: ${task.status} → ${newStatus}`,
    };
  }

  task.status = newStatus;

  if (newStatus === "in_progress" && !task.started_at) {
    task.started_at = new Date().toISOString();
  }
  if (newStatus === "done") {
    task.completed_at = new Date().toISOString();
  }
  if (newStatus === "todo") {
    task.completed_at = null;
  }

  // Apply extra fields (branch, pr, assignee, etc.)
  Object.assign(task, extra);

  await writeWbs(wbs);
  return { ok: true, task };
}

async function updateTaskFields(taskId, fields) {
  const wbs = await readWbs();
  const task = wbs.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, error: `Task ${taskId} not found` };

  Object.assign(task, fields);

  await writeWbs(wbs);
  return { ok: true, task };
}

async function addTasks(newTasks) {
  const wbs = await readWbs();
  const added = [];

  for (const t of newTasks) {
    // Deduplicate by issue_number + repository
    if (t.issue_number && t.repository) {
      const existing = findTaskByIssue(wbs, t.issue_number, t.repository);
      if (existing) {
        // Update existing task instead of creating duplicate
        if (t.assignee !== undefined) existing.assignee = t.assignee;
        if (t.labels) existing.labels = t.labels;
        added.push(existing);
        continue;
      }
    }

    const id = t.id || (t.issue_number && t.repository
      ? makeTaskId(t.issue_number, t.repository)
      : `task-${Date.now()}`);

    const task = {
      id,
      issue_number: t.issue_number || null,
      title: t.title,
      description: t.description || "",
      status: "todo",
      priority: t.priority || "medium",
      assignee: t.assignee || null,
      repository: t.repository || wbs.project,
      labels: t.labels || [],
      branch: null,
      pr: null,
      issue_url: t.issue_url || null,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      depends_on: t.depends_on || [],
    };
    wbs.tasks.push(task);
    added.push(task);
  }

  await writeWbs(wbs);
  return added;
}

module.exports = { readWbs, writeWbs, makeTaskId, findTaskByIssue, updateTaskStatus, updateTaskFields, addTasks };
