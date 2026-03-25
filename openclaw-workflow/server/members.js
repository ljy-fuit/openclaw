const fs = require("fs");
const path = require("path");
const lockfile = require("proper-lockfile");

const MEMBERS_PATH = path.resolve(__dirname, "..", "data", "members.json");

async function readMembers() {
  const raw = await fs.promises.readFile(MEMBERS_PATH, "utf-8");
  return JSON.parse(raw);
}

async function writeMembers(data) {
  data.updated_at = new Date().toISOString();
  let release;
  try {
    release = await lockfile.lock(MEMBERS_PATH, { retries: 3 });
    await fs.promises.writeFile(MEMBERS_PATH, JSON.stringify(data, null, 2), "utf-8");
  } finally {
    if (release) await release();
  }
}

function getNextMemberId(data) {
  let max = 0;
  for (const m of data.members) {
    const num = parseInt(m.id.replace("MEM-", ""), 10);
    if (num > max) max = num;
  }
  return `MEM-${String(max + 1).padStart(3, "0")}`;
}

function findMemberByName(data, name) {
  const q = name.toLowerCase().replace("@", "");
  return data.members.find(
    (m) =>
      m.name === name ||
      (m.name_en && m.name_en.toLowerCase() === q) ||
      (m.slack_display && m.slack_display.toLowerCase().replace("@", "") === q) ||
      m.id === name
  );
}

function findMemberByGithub(data, githubUsername) {
  if (!githubUsername) return null;
  const q = githubUsername.toLowerCase();
  return data.members.find(
    (m) => m.github && m.github.toLowerCase() === q
  );
}

async function addMember(memberInfo) {
  const data = await readMembers();

  // Deduplicate by github or slack_display
  const exists = data.members.find(
    (m) =>
      (memberInfo.github && m.github === memberInfo.github) ||
      (memberInfo.slack_display && m.slack_display === memberInfo.slack_display)
  );
  if (exists) return { ok: false, error: `Member already registered: ${exists.name} (${exists.id})`, member: exists };

  const id = getNextMemberId(data);
  const member = {
    id,
    name: memberInfo.name,
    name_en: memberInfo.name_en || null,
    slack_id: memberInfo.slack_id || null,
    slack_display: memberInfo.slack_display || null,
    github: memberInfo.github || null,
    role: memberInfo.role || null,
    skills: memberInfo.skills || [],
    projects: [],
    registered_at: new Date().toISOString(),
  };

  data.members.push(member);
  await writeMembers(data);
  return { ok: true, member };
}

async function updateMember(id, updates) {
  const data = await readMembers();
  const member = data.members.find((m) => m.id === id);
  if (!member) return { ok: false, error: `Member ${id} not found` };

  Object.assign(member, updates);
  await writeMembers(data);
  return { ok: true, member };
}

async function removeMember(id) {
  const data = await readMembers();
  const idx = data.members.findIndex((m) => m.id === id || m.name === id);
  if (idx === -1) return { ok: false, error: `Member ${id} not found` };

  const removed = data.members.splice(idx, 1)[0];
  await writeMembers(data);
  return { ok: true, removed };
}

async function assignToProject(memberName, projectInfo) {
  const data = await readMembers();
  const member = findMemberByName(data, memberName);
  if (!member) return { ok: false, error: `Member "${memberName}" not found` };

  // Check if already assigned
  const exists = member.projects.find((p) => p.repository === projectInfo.repository);
  if (exists) {
    exists.role_in_project = projectInfo.role_in_project || exists.role_in_project;
    await writeMembers(data);
    return { ok: true, member, updated: true };
  }

  member.projects.push({
    repository: projectInfo.repository,
    project_name: projectInfo.project_name || null,
    role_in_project: projectInfo.role_in_project || null,
    assigned_at: new Date().toISOString(),
  });

  await writeMembers(data);
  return { ok: true, member };
}

async function unassignFromProject(memberName, repository) {
  const data = await readMembers();
  const member = findMemberByName(data, memberName);
  if (!member) return { ok: false, error: `Member "${memberName}" not found` };

  const idx = member.projects.findIndex((p) => p.repository === repository);
  if (idx === -1) return { ok: false, error: `Member "${memberName}" is not assigned to ${repository}` };

  member.projects.splice(idx, 1);
  await writeMembers(data);
  return { ok: true, member };
}

module.exports = {
  readMembers,
  writeMembers,
  getNextMemberId,
  findMemberByName,
  findMemberByGithub,
  addMember,
  updateMember,
  removeMember,
  assignToProject,
  unassignFromProject,
};
