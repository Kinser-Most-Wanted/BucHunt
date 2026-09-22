const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const [owner, repo] = (repository || '').split('/');

async function api(route, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${route}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(`${response.status}: ${data.message || 'GitHub API error'}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function changedFiles() {
  const before = process.env.BEFORE_SHA;
  const after = process.env.AFTER_SHA || 'HEAD';
  if (!before || /^0+$/.test(before)) {
    // First push to a new branch: include files added by this commit.
    return execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', after], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  }
  return execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', before, after], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

function parsePbis(markdown, filename) {
  let sprint = null;
  let current = null;
  const pbis = [];
  function finish() {
    if (!current) return;
    current.body = current.lines.join('\n').trim();
    delete current.lines;
    if (!current.sprint) throw new Error(`${filename}: ${current.title} has no preceding # Sprint N heading`);
    const priority = current.body.match(/^###\s*Priority\s*:\s*(High|Medium|Low)\s*$/im);
    if (!priority) throw new Error(`${filename}: ${current.title} requires ### Priority: High, Medium, or Low`);
    current.title += ` - ${{ High: 'H', Medium: 'M', Low: 'L' }[priority[1][0].toUpperCase() + priority[1].slice(1).toLowerCase()]}`;
    pbis.push(current);
  }
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const sprintHeading = line.match(/^#\s+Sprint\s+#?(\d+)\s*$/i);
    const pbiHeading = line.match(/^##\s+PBI\s+(\d+)\s*[:\-]\s*(.+?)\s*$/i);
    if (sprintHeading) {
      finish();
      current = null;
      sprint = sprintHeading[1];
    } else if (pbiHeading) {
      finish();
      current = { sprint, title: `PBI ${pbiHeading[1]}: ${pbiHeading[2]}`, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  finish();
  return pbis;
}

async function ensureLabel(name, color) {
  try {
    await api(`/labels/${encodeURIComponent(name)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await api('/labels', { method: 'POST', body: JSON.stringify({ name, color }) });
  }
}

async function existingIssue(title) {
  let page = 1;
  while (true) {
    const issues = await api(`/issues?state=all&per_page=100&page=${page++}`);
    const found = issues.find(issue => !issue.pull_request && issue.title.toLowerCase() === title.toLowerCase());
    if (found) return found;
    if (issues.length < 100) break;
  }
  return null;
}

async function main() {
  if (!token || !owner || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
  const files = changedFiles().filter(file => /^pbis\/[^/]+\.md$/i.test(file) && fs.existsSync(file));
  const pbis = files.flatMap(file => parsePbis(fs.readFileSync(file, 'utf8'), file));
  if (!pbis.length) { console.log('No PBIs in changed Markdown files.'); return; }
  await ensureLabel('PBI', '5319E7');
  for (const pbi of pbis) {
    const sprintLabel = `Sprint ${pbi.sprint}`;
    await ensureLabel(sprintLabel, '0E8A16');
    const existing = await existingIssue(pbi.title);
    if (existing) { console.log(`Skipping existing issue #${existing.number}: ${pbi.title}`); continue; }
    const created = await api('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: pbi.title, body: pbi.body, labels: ['PBI', sprintLabel] }),
    });
    console.log(`Created #${created.number}: ${pbi.title}`);
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parsePbis };
