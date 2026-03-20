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
let profChart = null;

/**
 * Render the Type > Issue > Sub-Issue hierarchy with estimated vs actual time variance
 */
export function renderTypeBreakdown(tickets, picklists, timeEntries) {
  const hierarchy = buildTypeHierarchy(tickets, picklists, timeEntries);

  // Render variance table
  const tableEl = document.getElementById('typeTable');
  tableEl.innerHTML = buildVarianceTable(hierarchy);

  // Render variance bar chart (top issue types by negative variance)
  const canvas = document.getElementById('typeTreemap');
  if (typeChart) typeChart.destroy();

  // Flatten to issue level and sort by worst variance (most over-estimated)
  const issueVariances = [];
  hierarchy.forEach(type => {
    type.issues.forEach(issue => {
      if (issue.actual > 0 || issue.estimated > 0) {
        issueVariances.push({
          label: `${type.name} > ${issue.name}`,
          estimated: issue.estimated,
          actual: issue.actual,
          variance: issue.actual - issue.estimated
        });
      }
    });
  });

  // Sort by most negative variance (actual > estimated) first
  issueVariances.sort((a, b) => b.variance - a.variance);
  const top20 = issueVariances.slice(0, 20);

  typeChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top20.map(v => v.label),
      datasets: [
        {
          label: 'Estimated Hours',
          data: top20.map(v => Math.round(v.estimated * 10) / 10),
          backgroundColor: '#0d6efd88'
        },
        {
          label: 'Actual Hours',
          data: top20.map(v => Math.round(v.actual * 10) / 10),
          backgroundColor: top20.map(v => v.variance > 0 ? '#dc354588' : '#19875488')
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (idx !== undefined) {
                const v = top20[idx];
                const sign = v.variance > 0 ? '+' : '';
                return `Variance: ${sign}${Math.round(v.variance * 10) / 10} hrs`;
              }
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: 'Hours' } }
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
      const month = date.substring(0, 7);
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

/**
 * Render contract profitability analysis
 */
export function renderProfitability(contracts, timeEntries, resourceMap, roleMap, companyMap, contractPicklists) {
  // Group time entries by contract
  const teByContract = {};
  timeEntries.forEach(te => {
    const cid = te.contractID;
    if (!cid) return;
    if (!teByContract[cid]) teByContract[cid] = [];
    teByContract[cid].push(te);
  });

  // Calculate profitability per contract
  const contractData = contracts.map(contract => {
    const entries = teByContract[contract.id] || [];
    let totalHoursWorked = 0;
    let totalHoursToBill = 0;
    let totalCost = 0;
    let totalRevenue = 0;
    let roleRateSum = 0;
    let roleRateCount = 0;

    entries.forEach(te => {
      const hoursWorked = te.hoursWorked || 0;
      const hoursToBill = te.hoursToBill || 0;
      totalHoursWorked += hoursWorked;
      totalHoursToBill += hoursToBill;

      // Cost = hours worked * resource internal cost
      const resource = resourceMap[te.resourceID];
      const costRate = resource?.internalCost || 0;
      totalCost += hoursWorked * costRate;

      // Revenue = billable hours * role hourly rate
      const role = roleMap[te.roleID];
      const billingRate = role?.hourlyRate || 0;
      totalRevenue += hoursToBill * billingRate;

      if (billingRate > 0) {
        roleRateSum += billingRate;
        roleRateCount++;
      }
    });

    const grossMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
    const effectiveRate = totalHoursToBill > 0 ? totalRevenue / totalHoursToBill : 0;
    const avgRoleRate = roleRateCount > 0 ? roleRateSum / roleRateCount : 0;
    const effectiveRatio = avgRoleRate > 0 ? effectiveRate / avgRoleRate : 0;

    const typePl = contractPicklists?.contractType || {};

    return {
      id: contract.id,
      name: contract.contractName || `Contract #${contract.id}`,
      company: companyMap[contract.companyID] || `Company #${contract.companyID}`,
      type: typePl[contract.contractType] || contract.contractType || '-',
      lob: contract.businessDivisionSubdivisionID || '-',
      hoursWorked: Math.round(totalHoursWorked * 10) / 10,
      hoursToBill: Math.round(totalHoursToBill * 10) / 10,
      revenue: Math.round(totalRevenue * 100) / 100,
      cost: Math.round(totalCost * 100) / 100,
      grossMargin: Math.round(grossMargin * 10) / 10,
      effectiveRate: Math.round(effectiveRate * 100) / 100,
      avgRoleRate: Math.round(avgRoleRate * 100) / 100,
      effectiveRatio: Math.round(effectiveRatio * 100) / 100,
      entryCount: entries.length
    };
  }).filter(c => c.entryCount > 0);

  // Sort by gross margin ascending (worst first)
  contractData.sort((a, b) => a.grossMargin - b.grossMargin);

  // Update KPI cards
  const kpiSection = document.getElementById('profKPIs');
  kpiSection.style.display = '';

  document.getElementById('kpiContracts').textContent = contractData.length;

  if (contractData.length > 0) {
    const avgMargin = contractData.reduce((s, c) => s + c.grossMargin, 0) / contractData.length;
    const avgEffRate = contractData.reduce((s, c) => s + c.effectiveRate, 0) / contractData.length;
    const avgEffRatio = contractData.reduce((s, c) => s + c.effectiveRatio, 0) / contractData.length;

    const marginEl = document.getElementById('kpiMargin');
    marginEl.textContent = `${avgMargin.toFixed(1)}%`;
    marginEl.className = `fs-3 fw-bold ${avgMargin >= 0 ? 'text-success' : 'text-danger'}`;

    document.getElementById('kpiEffRate').textContent = `$${avgEffRate.toFixed(2)}`;

    const ratioEl = document.getElementById('kpiEffRatio');
    ratioEl.textContent = avgEffRatio.toFixed(2);
    ratioEl.className = `fs-3 fw-bold ${avgEffRatio >= 1 ? 'text-success' : 'text-danger'}`;
  }

  // Render chart
  const canvas = document.getElementById('profChart');
  if (profChart) profChart.destroy();

  const top25 = contractData.slice(0, 25);
  profChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top25.map(c => c.name.length > 30 ? c.name.substring(0, 27) + '...' : c.name),
      datasets: [
        {
          label: 'Revenue',
          data: top25.map(c => c.revenue),
          backgroundColor: '#19875488'
        },
        {
          label: 'Cost',
          data: top25.map(c => c.cost),
          backgroundColor: '#dc354588'
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (idx !== undefined) {
                const c = top25[idx];
                return [
                  `Margin: ${c.grossMargin}%`,
                  `Eff. Rate: $${c.effectiveRate}`,
                  `Eff. Ratio: ${c.effectiveRatio}`
                ];
              }
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: 'Dollars ($)' } }
      }
    }
  });

  // Render table
  const tableEl = document.getElementById('profTable');
  tableEl.innerHTML = `
    <table class="table table-sm table-striped" style="font-size: 0.8rem;">
      <thead>
        <tr>
          <th>Contract</th>
          <th>Company</th>
          <th>Type</th>
          <th class="text-end">Revenue</th>
          <th class="text-end">Cost</th>
          <th class="text-end">Margin %</th>
          <th class="text-end">Eff. Rate</th>
          <th class="text-end">Eff. Ratio</th>
        </tr>
      </thead>
      <tbody>
        ${contractData.map(c => `
          <tr>
            <td title="${c.name}">${c.name.length > 25 ? c.name.substring(0, 22) + '...' : c.name}</td>
            <td>${c.company}</td>
            <td>${c.type}</td>
            <td class="text-end">$${c.revenue.toLocaleString()}</td>
            <td class="text-end">$${c.cost.toLocaleString()}</td>
            <td class="text-end ${c.grossMargin >= 0 ? 'text-success' : 'text-danger'}">${c.grossMargin}%</td>
            <td class="text-end">$${c.effectiveRate.toFixed(2)}</td>
            <td class="text-end ${c.effectiveRatio >= 1 ? 'text-success' : 'text-danger'}">${c.effectiveRatio.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// --- Helpers ---

function buildTypeHierarchy(tickets, picklists, timeEntries) {
  const typePl = picklists.ticketType || {};
  const issuePl = picklists.issueType || {};
  const subIssuePl = picklists.subIssueType || {};

  // Build time entry map: ticketID -> total actual hours + entry count
  const teByTicket = {};
  (timeEntries || []).forEach(te => {
    if (te.ticketID) {
      if (!teByTicket[te.ticketID]) teByTicket[te.ticketID] = { actual: 0, entries: 0 };
      teByTicket[te.ticketID].actual += te.hoursWorked || 0;
      teByTicket[te.ticketID].entries++;
    }
  });

  const tree = {};
  tickets.forEach(t => {
    const typeId = t.ticketType || 0;
    const issueId = t.issueType || 0;
    const subIssueId = t.subIssueType || 0;
    const estimated = t.estimatedHours || 0;
    const te = teByTicket[t.id] || { actual: 0, entries: 0 };

    if (!tree[typeId]) tree[typeId] = { count: 0, estimated: 0, actual: 0, issues: {} };
    tree[typeId].count++;
    tree[typeId].estimated += estimated;
    tree[typeId].actual += te.actual;

    if (issueId) {
      if (!tree[typeId].issues[issueId]) tree[typeId].issues[issueId] = { count: 0, estimated: 0, actual: 0, subIssues: {} };
      tree[typeId].issues[issueId].count++;
      tree[typeId].issues[issueId].estimated += estimated;
      tree[typeId].issues[issueId].actual += te.actual;

      if (subIssueId) {
        if (!tree[typeId].issues[issueId].subIssues[subIssueId]) {
          tree[typeId].issues[issueId].subIssues[subIssueId] = { count: 0, estimated: 0, actual: 0 };
        }
        tree[typeId].issues[issueId].subIssues[subIssueId].count++;
        tree[typeId].issues[issueId].subIssues[subIssueId].estimated += estimated;
        tree[typeId].issues[issueId].subIssues[subIssueId].actual += te.actual;
      }
    }
  });

  return Object.entries(tree)
    .map(([typeId, data]) => ({
      name: typePl[typeId] || `Type #${typeId}`,
      count: data.count,
      estimated: Math.round(data.estimated * 10) / 10,
      actual: Math.round(data.actual * 10) / 10,
      variance: Math.round((data.actual - data.estimated) * 10) / 10,
      issues: Object.entries(data.issues)
        .map(([issueId, iData]) => ({
          name: issuePl[issueId] || `Issue #${issueId}`,
          count: iData.count,
          estimated: Math.round(iData.estimated * 10) / 10,
          actual: Math.round(iData.actual * 10) / 10,
          variance: Math.round((iData.actual - iData.estimated) * 10) / 10,
          subIssues: Object.entries(iData.subIssues)
            .map(([subId, sData]) => ({
              name: subIssuePl[subId] || `Sub-Issue #${subId}`,
              count: sData.count,
              estimated: Math.round(sData.estimated * 10) / 10,
              actual: Math.round(sData.actual * 10) / 10,
              variance: Math.round((sData.actual - sData.estimated) * 10) / 10
            }))
            .sort((a, b) => b.variance - a.variance)
        }))
        .sort((a, b) => b.variance - a.variance)
    }))
    .sort((a, b) => b.variance - a.variance);
}

function buildVarianceTable(hierarchy) {
  let html = '<table class="table table-sm" style="font-size: 0.85rem;">';
  html += '<thead><tr><th>Type / Issue / Sub-Issue</th><th class="text-end">Tickets</th><th class="text-end">Est. Hrs</th><th class="text-end">Act. Hrs</th><th class="text-end">Variance</th></tr></thead><tbody>';

  hierarchy.forEach(type => {
    const varianceClass = type.variance > 0 ? 'text-danger' : type.variance < 0 ? 'text-success' : '';
    const sign = type.variance > 0 ? '+' : '';
    html += `<tr class="table-primary">
      <td><strong>${type.name}</strong></td>
      <td class="text-end"><strong>${type.count}</strong></td>
      <td class="text-end">${type.estimated}</td>
      <td class="text-end">${type.actual}</td>
      <td class="text-end ${varianceClass}"><strong>${sign}${type.variance}</strong></td>
    </tr>`;

    type.issues.forEach(issue => {
      const iVarClass = issue.variance > 0 ? 'text-danger' : issue.variance < 0 ? 'text-success' : '';
      const iSign = issue.variance > 0 ? '+' : '';
      html += `<tr>
        <td class="ps-4">${issue.name}</td>
        <td class="text-end">${issue.count}</td>
        <td class="text-end">${issue.estimated}</td>
        <td class="text-end">${issue.actual}</td>
        <td class="text-end ${iVarClass}">${iSign}${issue.variance}</td>
      </tr>`;

      issue.subIssues.forEach(sub => {
        const sVarClass = sub.variance > 0 ? 'text-danger' : sub.variance < 0 ? 'text-success' : '';
        const sSign = sub.variance > 0 ? '+' : '';
        html += `<tr class="text-muted">
          <td class="ps-5"><small>${sub.name}</small></td>
          <td class="text-end"><small>${sub.count}</small></td>
          <td class="text-end"><small>${sub.estimated}</small></td>
          <td class="text-end"><small>${sub.actual}</small></td>
          <td class="text-end ${sVarClass}"><small>${sSign}${sub.variance}</small></td>
        </tr>`;
      });
    });
  });

  html += '</tbody></table>';
  return html;
}
