const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const [owner, repo] = (repository || '').split('/');
const projectsToken = process.env.PROJECTS_TOKEN;

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

async function graphql(query, variables = {}) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${projectsToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length) {
    throw new Error(`Projects API: ${result.errors?.map(e => e.message).join('; ') || result.message || response.status}`);
  }
  return result.data;
}

async function findProjects() {
  const data = await graphql(`query($org: String!) {
    organization(login: $org) {
      projectsV2(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id title
          fields(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              ... on ProjectV2SingleSelectField { id name options { id name } }
              ... on ProjectV2IterationField { id name configuration { iterations { id title } completedIterations { id title } } }
            }
          }
        }
      }
    }
  }`, { org: owner });
  const projects = data.organization?.projectsV2;
  if (!projects || projects.pageInfo.hasNextPage) throw new Error('Cannot uniquely find both projects in the first 100 organization projects');
  const named = title => {
    const matches = projects.nodes.filter(p => p.title.toLowerCase() === title.toLowerCase());
    if (matches.length !== 1) throw new Error(`Expected one project named "${title}", found ${matches.length}`);
    if (matches[0].fields.pageInfo.hasNextPage) throw new Error(`Too many fields in ${title}`);
    return matches[0];
  };
  const product = named(process.env.PRODUCT_BACKLOG_NAME || 'Product Backlog');
  const sprint = named(process.env.SPRINT_BACKLOG_NAME || 'Sprint Backlog');
  if (product.id === sprint.id) throw new Error('Product and Sprint Backlog must be different projects');
  const sprintStatus = sprint.fields.nodes.find(f => f?.name === 'Status');
  if (!sprintStatus) throw new Error('Sprint Backlog needs a Status field for the No Status column');
  return { product, sprint, sprintStatus };
}

function sprintOption(project, sprintNumber) {
  const name = `Sprint ${sprintNumber}`;
  const fields = project.fields.nodes.filter(f => f && (f.name === 'Sprint' || f.name === 'Status'));
  const matches = fields.flatMap(field => {
    const values = field.options || field.configuration?.iterations || [];
    return values.filter(v => v.name?.toLowerCase() === name.toLowerCase() || v.title?.toLowerCase() === name.toLowerCase())
      .map(value => ({ fieldId: field.id, optionId: value.id, iteration: Boolean(field.configuration) }));
  });
  const preferred = fields.find(f => f.name === 'Sprint');
  const option = matches.find(v => v.fieldId === preferred?.id) || matches[0];
  if (!option) throw new Error(`${project.title} needs a Sprint or Status column option named "${name}"`);
  return option;
}

async function linkedItems(issueNodeId) {
  const data = await graphql(`query($id: ID!) {
    node(id: $id) {
      ... on Issue {
        projectItems(first: 100) {
          pageInfo { hasNextPage }
          nodes { id project { id } }
        }
      }
    }
  }`, { id: issueNodeId });
  const items = data.node?.projectItems;
  if (!items || items.pageInfo.hasNextPage) throw new Error('Cannot inspect all existing project items for issue');
  return items.nodes;
}

async function addToProject(project, issueNodeId, existingItems) {
  const existing = existingItems.find(item => item.project.id === project.id);
  if (existing) return { id: existing.id, added: false };
  const data = await graphql(`mutation($project: ID!, $issue: ID!) {
    addProjectV2ItemById(input: { projectId: $project, contentId: $issue }) { item { id } }
  }`, { project: project.id, issue: issueNodeId });
  return { id: data.addProjectV2ItemById.item.id, added: true };
}

async function putInSprint(project, itemId, option) {
  const value = option.iteration ? { iterationId: option.optionId } : { singleSelectOptionId: option.optionId };
  await graphql(`mutation($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $project, itemId: $item, fieldId: $field, value: $value
    }) { projectV2Item { id } }
  }`, { project: project.id, item: itemId, field: option.fieldId, value });
}

async function clearStatus(project, itemId, fieldId) {
  await graphql(`mutation($project: ID!, $item: ID!, $field: ID!) {
    clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) {
      projectV2Item { id }
    }
  }`, { project: project.id, item: itemId, field: fieldId });
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
  if (!projectsToken) throw new Error('Set the PROJECTS_TOKEN Actions secret with access to both organization projects');
  const projects = await findProjects();
  // Validate every destination before creating any issues.
  const destinations = pbis.map(pbi => sprintOption(projects.product, pbi.sprint));
  await ensureLabel('PBI', '5319E7');
  for (const [index, pbi] of pbis.entries()) {
    const sprintLabel = `Sprint ${pbi.sprint}`;
    await ensureLabel(sprintLabel, '0E8A16');
    const existing = await existingIssue(pbi.title);
    const issue = existing || await api('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: pbi.title, body: pbi.body, labels: ['PBI', sprintLabel] }),
    });
    console.log(`${existing ? 'Found' : 'Created'} #${issue.number}: ${pbi.title}`);
    const items = await linkedItems(issue.node_id);
    const productItem = await addToProject(projects.product, issue.node_id, items);
    await putInSprint(projects.product, productItem.id, destinations[index]);
    const sprintItem = await addToProject(projects.sprint, issue.node_id, items);
    // No Status is an unset Status value. Preserve an existing issue's manually managed status.
    // A project auto-add workflow may have added a newly created issue before this step.
    if (sprintItem.added || !existing) await clearStatus(projects.sprint, sprintItem.id, projects.sprintStatus.id);
    console.log(`Routed #${issue.number} to ${sprintLabel} in Product Backlog and No Status in Sprint Backlog`);
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parsePbis, sprintOption };
