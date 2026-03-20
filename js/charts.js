// Chart rendering helpers using Chart.js

const COLORS = [
  '#0d6efd', '#6610f2', '#6f42c1', '#d63384', '#dc3545',
  '#fd7e14', '#ffc107', '#198754', '#20c997', '#0dcaf0',
  '#6c757d', '#adb5bd', '#495057', '#1a73e8', '#e91e63',
  '#9c27b0', '#673ab7', '#3f51b5', '#00bcd4', '#4caf50'
];

let typeChart = null;
let contactChart = null;
let ciChart = null;
let trendChart = null;

/**
 * Render the Type > Issue > Sub-Issue hierarchy treemap and table
 */
export function renderTypeBreakdown(tickets, picklists) {
  const hierarchy = buildTypeHierarchy(tickets, picklists);

  // Render expandable table
  const tableEl = document.getElementById('typeTable');
  tableEl.innerHTML = buildHierarchyTable(hierarchy);

  // Render treemap
  const canvas = document.getElementById('typeTreemap');
  if (typeChart) typeChart.destroy();

  const treeData = [];
  hierarchy.forEach(type => {
    type.issues.forEach(issue => {
      treeData.push({
        label: `${type.name} > ${issue.name}`,
        value: issue.count
      });
    });
    if (type.issues.length === 0) {
      treeData.push({ label: type.name, value: type.count });
    }
  });

  typeChart = new Chart(canvas, {
    type: 'treemap',
    data: {
      datasets: [{
        tree: treeData,
        key: 'value',
        labels: { display: true, formatter: (ctx) => ctx.raw._data?.label || '' },
        backgroundColor: (ctx) => COLORS[ctx.dataIndex % COLORS.length] + 'CC',
        borderColor: '#fff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.raw._data?.label || '',
            label: (item) => `Count: ${item.raw._data?.value || 0}`
          }
        }
      }
    }
  });
}

/**
 * Render top contacts horizontal bar chart and table
 */
export function renderContactBreakdown(tickets, contactMap) {
  const counts = {};
  tickets.forEach(t => {
    if (t.contactID) {
      counts[t.contactID] = (counts[t.contactID] || 0) + 1;
    }
  });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const labels = sorted.map(([id]) => contactMap[id] || `Contact #${id}`);
  const values = sorted.map(([, count]) => count);

  // Chart
  const canvas = document.getElementById('contactChart');
  if (contactChart) contactChart.destroy();

  contactChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Tickets', data: values, backgroundColor: COLORS.slice(0, sorted.length) }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, title: { display: true, text: 'Ticket Count' } } }
    }
  });

  // Table
  const tableEl = document.getElementById('contactTable');
  tableEl.innerHTML = `
    <table class="table table-sm table-striped">
      <thead><tr><th>#</th><th>Contact</th><th>Tickets</th><th>%</th></tr></thead>
      <tbody>
        ${sorted.map(([id, count], i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${contactMap[id] || `Contact #${id}`}</td>
            <td>${count}</td>
            <td>${((count / tickets.length) * 100).toFixed(1)}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

/**
 * Render top configuration items chart and table
 */
export function renderCIBreakdown(tickets, ciMap) {
  const counts = {};
  tickets.forEach(t => {
    if (t.configurationItemID) {
      counts[t.configurationItemID] = (counts[t.configurationItemID] || 0) + 1;
    }
  });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const labels = sorted.map(([id]) => ciMap[id] || `CI #${id}`);
  const values = sorted.map(([, count]) => count);

  const canvas = document.getElementById('ciChart');
  if (ciChart) ciChart.destroy();

  ciChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Tickets', data: values, backgroundColor: COLORS.slice(0, sorted.length) }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, title: { display: true, text: 'Ticket Count' } } }
    }
  });

  const tableEl = document.getElementById('ciTable');
  tableEl.innerHTML = `
    <table class="table table-sm table-striped">
      <thead><tr><th>#</th><th>Config Item</th><th>Tickets</th><th>%</th></tr></thead>
      <tbody>
        ${sorted.map(([id, count], i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${ciMap[id] || `CI #${id}`}</td>
            <td>${count}</td>
            <td>${((count / tickets.length) * 100).toFixed(1)}%</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

/**
 * Render ticket volume trend line chart
 */
export function renderTrendChart(tickets) {
  const monthly = {};
  tickets.forEach(t => {
    const date = t.createDate || t.lastActivityDate;
    if (date) {
      const month = date.substring(0, 7); // YYYY-MM
      monthly[month] = (monthly[month] || 0) + 1;
    }
  });

  const sortedMonths = Object.keys(monthly).sort();
  const values = sortedMonths.map(m => monthly[m]);

  const canvas = document.getElementById('trendChart');
  if (trendChart) trendChart.destroy();

  trendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: sortedMonths,
      datasets: [{
        label: 'Tickets',
        data: values,
        borderColor: '#0d6efd',
        backgroundColor: '#0d6efd22',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Month' } },
        y: { beginAtZero: true, title: { display: true, text: 'Ticket Count' } }
      }
    }
  });
}

// --- Helpers ---

function buildTypeHierarchy(tickets, picklists) {
  const typePl = picklists.ticketType || {};
  const issuePl = picklists.issueType || {};
  const subIssuePl = picklists.subIssueType || {};

  const tree = {};
  tickets.forEach(t => {
    const typeId = t.ticketType || 0;
    const issueId = t.issueType || 0;
    const subIssueId = t.subIssueType || 0;

    if (!tree[typeId]) tree[typeId] = { issues: {} };
    tree[typeId].count = (tree[typeId].count || 0) + 1;

    if (issueId) {
      if (!tree[typeId].issues[issueId]) tree[typeId].issues[issueId] = { subIssues: {} };
      tree[typeId].issues[issueId].count = (tree[typeId].issues[issueId].count || 0) + 1;

      if (subIssueId) {
        tree[typeId].issues[issueId].subIssues[subIssueId] =
          (tree[typeId].issues[issueId].subIssues[subIssueId] || 0) + 1;
      }
    }
  });

  return Object.entries(tree)
    .map(([typeId, data]) => ({
      name: typePl[typeId] || `Type #${typeId}`,
      count: data.count,
      issues: Object.entries(data.issues)
        .map(([issueId, iData]) => ({
          name: issuePl[issueId] || `Issue #${issueId}`,
          count: iData.count,
          subIssues: Object.entries(iData.subIssues)
            .map(([subId, count]) => ({
              name: subIssuePl[subId] || `Sub-Issue #${subId}`,
              count
            }))
            .sort((a, b) => b.count - a.count)
        }))
        .sort((a, b) => b.count - a.count)
    }))
    .sort((a, b) => b.count - a.count);
}

function buildHierarchyTable(hierarchy) {
  let html = '<table class="table table-sm">';
  html += '<thead><tr><th>Type / Issue / Sub-Issue</th><th class="text-end">Count</th></tr></thead><tbody>';

  hierarchy.forEach(type => {
    html += `<tr class="table-primary"><td><strong>${type.name}</strong></td><td class="text-end"><strong>${type.count}</strong></td></tr>`;
    type.issues.forEach(issue => {
      html += `<tr><td class="ps-4">${issue.name}</td><td class="text-end">${issue.count}</td></tr>`;
      issue.subIssues.forEach(sub => {
        html += `<tr class="text-muted"><td class="ps-5"><small>${sub.name}</small></td><td class="text-end"><small>${sub.count}</small></td></tr>`;
      });
    });
  });

  html += '</tbody></table>';
  return html;
}
