// Analysis page - data orchestration, agent chat, and tab coordination

import { getSettings } from './config.js';
import {
  fetchTickets, fetchPicklists, fetchContacts, fetchConfigItems,
  fetchCompanies, fetchTimeEntries, fetchContracts, fetchContractPicklists,
  fetchResources, fetchRoles, fetchBusinessDivisions, chatCompletion
} from './api.js';
import {
  renderTypeBreakdown, renderContactBreakdown, renderCIBreakdown,
  renderTrendChart, renderProfitability
} from './charts.js';
import { showToast, setButtonLoading, initNav } from './ui.js';

initNav();

// State
let tickets = [];
let timeEntries = [];
let picklists = { ticketType: {}, issueType: {}, subIssueType: {} };
let contactMap = {};
let ciMap = {};
let companiesList = [];
let conversationHistory = [];

// DOM refs
const fetchBtn = document.getElementById('fetchBtn');
const ticketCountEl = document.getElementById('ticketCount');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatMessages = document.getElementById('chatMessages');
const companyFilter = document.getElementById('companyFilter');
const profCompany = document.getElementById('profCompany');
const profLOB = document.getElementById('profLOB');
const fetchProfBtn = document.getElementById('fetchProfBtn');

// Load companies on page init for dropdowns
async function loadCompanies() {
  const settings = getSettings();
  if (!settings.worker.url) return;

  try {
    const result = await fetchCompanies();
    companiesList = result.items || [];
    populateCompanyDropdowns(companiesList);
  } catch (err) {
    console.warn('Could not load companies:', err.message);
  }
}

function populateCompanyDropdowns(companies) {
  // Clear and repopulate both dropdowns
  [companyFilter, profCompany].forEach(select => {
    const currentVal = select.value;
    select.innerHTML = '<option value="">All Companies</option>';
    companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
    select.value = currentVal;
  });
}

// Load LOBs for profitability filter
async function loadLOBs() {
  const settings = getSettings();
  if (!settings.worker.url) return;

  try {
    const result = await fetchBusinessDivisions();
    const lobs = result.items || [];
    profLOB.innerHTML = '<option value="">All Lines of Business</option>';
    lobs.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      profLOB.appendChild(opt);
    });
  } catch (err) {
    console.warn('Could not load LOBs:', err.message);
  }
}

// Initialize dropdowns
loadCompanies();
loadLOBs();

// Fetch ticket data
fetchBtn.addEventListener('click', async () => {
  const settings = getSettings();
  if (!settings.worker.url) {
    showToast('Please configure the Worker URL in Settings first.', 'warning');
    return;
  }

  setButtonLoading(fetchBtn, true);

  try {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const companyId = companyFilter.value;

    const filters = {};
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;
    if (companyId) filters.companyId = companyId;

    // Fetch tickets and picklists in parallel
    const [ticketResult, picklistResult] = await Promise.all([
      fetchTickets(filters),
      fetchPicklists()
    ]);

    tickets = ticketResult.items || [];
    picklists = picklistResult;

    ticketCountEl.textContent = `${tickets.length} tickets loaded`;

    // Collect unique contact and CI IDs for resolution
    const contactIds = [...new Set(tickets.map(t => t.contactID).filter(Boolean))];
    const ciIds = [...new Set(tickets.map(t => t.configurationItemID).filter(Boolean))];

    // Fetch time entries for these tickets (for variance analysis)
    const ticketIds = tickets.map(t => t.id).filter(Boolean);

    // Resolve names + time entries in parallel
    const [contactResult, ciResult, timeResult] = await Promise.all([
      contactIds.length > 0 ? fetchContacts(contactIds) : Promise.resolve({}),
      ciIds.length > 0 ? fetchConfigItems(ciIds) : Promise.resolve({}),
      ticketIds.length > 0 ? fetchTimeEntries({ ticketIds }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] })
    ]);

    contactMap = contactResult || {};
    ciMap = ciResult || {};
    timeEntries = timeResult.items || [];

    // Render all chart views
    renderTypeBreakdown(tickets, picklists, timeEntries);
    renderContactBreakdown(tickets, contactMap);
    renderCIBreakdown(tickets, ciMap);
    renderTrendChart(tickets);

    // Enable chat
    chatInput.disabled = false;
    chatSendBtn.disabled = false;

    showToast(`Loaded ${tickets.length} tickets with ${timeEntries.length} time entries.`, 'success');
  } catch (err) {
    showToast(`Failed to fetch data: ${err.message}`, 'error');
  } finally {
    setButtonLoading(fetchBtn, false);
  }
});

// Profitability fetch
fetchProfBtn.addEventListener('click', async () => {
  const settings = getSettings();
  if (!settings.worker.url) {
    showToast('Please configure the Worker URL in Settings first.', 'warning');
    return;
  }

  setButtonLoading(fetchProfBtn, true);

  try {
    const companyId = profCompany.value;
    const lobId = profLOB.value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    // Fetch contracts, resources, roles in parallel
    const contractFilters = {};
    if (companyId) contractFilters.companyId = companyId;

    const [contractResult, resourceResult, roleResult, contractPicklists] = await Promise.all([
      fetchContracts(contractFilters),
      fetchResources(),
      fetchRoles(),
      fetchContractPicklists().catch(() => ({}))
    ]);

    let contracts = contractResult.items || [];
    const resources = resourceResult.items || [];
    const roles = roleResult.items || [];

    // Filter by LOB (organizationalLevelAssociationID) if selected
    if (lobId) {
      contracts = contracts.filter(c =>
        c.organizationalLevelAssociationID == lobId
      );
    }

    if (contracts.length === 0) {
      showToast('No contracts found for the selected filters.', 'warning');
      setButtonLoading(fetchProfBtn, false);
      return;
    }

    // Fetch time entries for these contracts
    const contractIds = contracts.map(c => c.id);
    const teFilters = { contractIds };
    if (dateFrom) teFilters.dateFrom = dateFrom;
    if (dateTo) teFilters.dateTo = dateTo;

    const teResult = await fetchTimeEntries(teFilters).catch(() => ({ items: [] }));
    const contractTimeEntries = teResult.items || [];

    // Build resource and role lookup maps
    const resourceMap = {};
    resources.forEach(r => { resourceMap[r.id] = r; });
    const roleMap = {};
    roles.forEach(r => { roleMap[r.id] = r; });

    // Build company name map from companiesList
    const companyMap = {};
    companiesList.forEach(c => { companyMap[c.id] = c.name; });

    // Render profitability
    renderProfitability(contracts, contractTimeEntries, resourceMap, roleMap, companyMap, contractPicklists);

    showToast(`Analyzed ${contracts.length} contracts with ${contractTimeEntries.length} time entries.`, 'success');
  } catch (err) {
    showToast(`Failed to fetch profitability data: ${err.message}`, 'error');
  } finally {
    setButtonLoading(fetchProfBtn, false);
  }
});

// Chat - send message
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

async function sendChat() {
  const question = chatInput.value.trim();
  if (!question || tickets.length === 0) return;

  chatInput.value = '';
  appendChatMessage('user', question);

  // Build data context
  const dataContext = buildDataContext(tickets, picklists, contactMap, ciMap, timeEntries);

  // Build messages array
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Current ticket data summary:\n\`\`\`json\n${JSON.stringify(dataContext, null, 2)}\n\`\`\`` },
    ...conversationHistory,
    { role: 'user', content: question }
  ];

  // Show typing indicator
  const typingEl = appendChatMessage('assistant', '<em>Analyzing...</em>');

  try {
    const result = await chatCompletion(messages);
    const reply = result.choices?.[0]?.message?.content || 'No response received.';

    // Update typing indicator with real response
    typingEl.querySelector('.bubble').innerHTML = renderMarkdown(reply);

    // Store in conversation history
    conversationHistory.push({ role: 'user', content: question });
    conversationHistory.push({ role: 'assistant', content: reply });

    // Keep conversation history manageable (last 20 turns)
    if (conversationHistory.length > 40) {
      conversationHistory = conversationHistory.slice(-40);
    }
  } catch (err) {
    typingEl.querySelector('.bubble').innerHTML =
      `<span class="text-danger">Error: ${err.message}</span>`;
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendChatMessage(role, html) {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${role}`;
  msgEl.innerHTML = `<div class="bubble">${html}</div>`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msgEl;
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/**
 * Build a compact data context for the LLM (now includes time variance data)
 */
function buildDataContext(tickets, picklists, contactMap, ciMap, timeEntries) {
  const typePl = picklists.ticketType || {};
  const issuePl = picklists.issueType || {};
  const subIssuePl = picklists.subIssueType || {};

  // Build time entry map: ticketID -> total hours worked
  const teByTicket = {};
  (timeEntries || []).forEach(te => {
    if (te.ticketID) {
      if (!teByTicket[te.ticketID]) teByTicket[te.ticketID] = { actual: 0, entries: 0 };
      teByTicket[te.ticketID].actual += te.hoursWorked || 0;
      teByTicket[te.ticketID].entries++;
    }
  });

  // Type > Issue > Sub-Issue hierarchy with variance
  const byType = {};
  const byContact = {};
  const byCI = {};
  const byMonth = {};
  const byStatus = {};

  tickets.forEach(t => {
    const typeName = typePl[t.ticketType] || `Type #${t.ticketType || 'Unknown'}`;
    const issueName = issuePl[t.issueType] || (t.issueType ? `Issue #${t.issueType}` : 'No Issue');
    const subIssueName = subIssuePl[t.subIssueType] || (t.subIssueType ? `Sub #${t.subIssueType}` : 'No Sub-Issue');

    const estimated = t.estimatedHours || 0;
    const te = teByTicket[t.id] || { actual: 0, entries: 0 };

    if (!byType[typeName]) byType[typeName] = { count: 0, estimated: 0, actual: 0, issues: {} };
    byType[typeName].count++;
    byType[typeName].estimated += estimated;
    byType[typeName].actual += te.actual;

    if (!byType[typeName].issues[issueName]) byType[typeName].issues[issueName] = { count: 0, estimated: 0, actual: 0, subIssues: {} };
    byType[typeName].issues[issueName].count++;
    byType[typeName].issues[issueName].estimated += estimated;
    byType[typeName].issues[issueName].actual += te.actual;

    if (!byType[typeName].issues[issueName].subIssues[subIssueName]) {
      byType[typeName].issues[issueName].subIssues[subIssueName] = { count: 0, estimated: 0, actual: 0 };
    }
    byType[typeName].issues[issueName].subIssues[subIssueName].count++;
    byType[typeName].issues[issueName].subIssues[subIssueName].estimated += estimated;
    byType[typeName].issues[issueName].subIssues[subIssueName].actual += te.actual;

    // Contact
    if (t.contactID) {
      const name = contactMap[t.contactID] || `Contact #${t.contactID}`;
      byContact[name] = (byContact[name] || 0) + 1;
    }

    // CI
    if (t.configurationItemID) {
      const name = ciMap[t.configurationItemID] || `CI #${t.configurationItemID}`;
      byCI[name] = (byCI[name] || 0) + 1;
    }

    // Monthly trend
    const date = t.createDate || t.lastActivityDate;
    if (date) {
      const month = date.substring(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    // Status
    const status = t.status || 'Unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  });

  const typeHierarchy = Object.entries(byType)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([type, data]) => ({
      type,
      count: data.count,
      estimatedHours: Math.round(data.estimated * 10) / 10,
      actualHours: Math.round(data.actual * 10) / 10,
      variance: Math.round((data.actual - data.estimated) * 10) / 10,
      issues: Object.entries(data.issues)
        .sort((a, b) => (b[1].actual - b[1].estimated) - (a[1].actual - a[1].estimated))
        .slice(0, 15)
        .map(([issue, iData]) => ({
          issue,
          count: iData.count,
          estimatedHours: Math.round(iData.estimated * 10) / 10,
          actualHours: Math.round(iData.actual * 10) / 10,
          variance: Math.round((iData.actual - iData.estimated) * 10) / 10
        }))
    }));

  const topContacts = Object.entries(byContact)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }));

  const topCIs = Object.entries(byCI)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }));

  const monthlyTrend = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, count]) => ({ month, count }));

  return {
    totalTickets: tickets.length,
    totalTimeEntries: (timeEntries || []).length,
    byType: typeHierarchy,
    topContacts,
    topConfigItems: topCIs,
    byMonth: monthlyTrend,
    byStatus
  };
}

// System prompt for the LLM
const SYSTEM_PROMPT = `You are an expert IT service management analyst. You analyze Autotask PSA ticket data for a managed services provider.

You will receive a JSON summary of ticket data that includes:
- Ticket counts by Type > Issue Type > Sub-Issue Type hierarchy WITH estimated vs actual hours and variance
- Top ticket-submitting contacts and their companies
- Top configuration items generating tickets
- Monthly ticket volume trends
- Status distribution

When answering questions:
1. Reference specific numbers from the data
2. Calculate percentages and ratios where helpful
3. Identify outliers and anomalies (e.g., a single contact submitting 30% of tickets)
4. For time variance analysis, highlight issue types with the highest NEGATIVE variance (actual exceeded estimated)
5. Suggest actionable next steps (e.g., "Consider revising estimates for [issue type] - actual hours exceed estimates by X%")
6. Format tables in markdown for easy reading
7. If the data doesn't contain enough information to answer, say so clearly

Do NOT make up ticket data. Only reference numbers present in the provided dataset.`;
