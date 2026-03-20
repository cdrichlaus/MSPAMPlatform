// Analysis page - data orchestration, agent chat, and tab coordination

import { getSettings } from './config.js';
import { fetchTickets, fetchPicklists, fetchContacts, fetchConfigItems, chatCompletion } from './api.js';
import { renderTypeBreakdown, renderContactBreakdown, renderCIBreakdown, renderTrendChart } from './charts.js';
import { showToast, setButtonLoading, initNav } from './ui.js';

initNav();

// State
let tickets = [];
let picklists = { ticketType: {}, issueType: {}, subIssueType: {} };
let contactMap = {};
let ciMap = {};
let conversationHistory = [];

// DOM refs
const fetchBtn = document.getElementById('fetchBtn');
const ticketCountEl = document.getElementById('ticketCount');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatMessages = document.getElementById('chatMessages');

// Fetch data
fetchBtn.addEventListener('click', async () => {
  const settings = getSettings();
  if (!settings.worker.url) {
    showToast('Please configure the Worker URL in Settings first.', 'warning');
    return;
  }

  setButtonLoading(fetchBtn, true);
  fetchBtn.querySelector('.bi')?.classList.add('spin');

  try {
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const companyFilter = document.getElementById('companyFilter').value;

    const filters = {};
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;
    if (companyFilter) filters.companyId = companyFilter;

    // Fetch tickets and picklists in parallel
    const [ticketResult, picklistResult] = await Promise.all([
      fetchTickets(filters),
      fetchPicklists()
    ]);

    tickets = ticketResult.items || ticketResult;
    picklists = picklistResult;

    ticketCountEl.textContent = `${tickets.length} tickets loaded`;

    // Collect unique contact and CI IDs for resolution
    const contactIds = [...new Set(tickets.map(t => t.contactID).filter(Boolean))];
    const ciIds = [...new Set(tickets.map(t => t.configurationItemID).filter(Boolean))];

    // Resolve names in parallel
    const [contactResult, ciResult] = await Promise.all([
      contactIds.length > 0 ? fetchContacts(contactIds) : {},
      ciIds.length > 0 ? fetchConfigItems(ciIds) : {}
    ]);

    contactMap = contactResult;
    ciMap = ciResult;

    // Render all chart views
    renderTypeBreakdown(tickets, picklists);
    renderContactBreakdown(tickets, contactMap);
    renderCIBreakdown(tickets, ciMap);
    renderTrendChart(tickets);

    // Enable chat
    chatInput.disabled = false;
    chatSendBtn.disabled = false;

    showToast(`Loaded ${tickets.length} tickets successfully.`, 'success');
  } catch (err) {
    showToast(`Failed to fetch data: ${err.message}`, 'error');
  } finally {
    setButtonLoading(fetchBtn, false);
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
  const dataContext = buildDataContext(tickets, picklists, contactMap, ciMap);

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
  // Fallback: basic escaping
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/**
 * Build a compact data context for the LLM
 */
function buildDataContext(tickets, picklists, contactMap, ciMap) {
  const typePl = picklists.ticketType || {};
  const issuePl = picklists.issueType || {};
  const subIssuePl = picklists.subIssueType || {};

  // Type > Issue > Sub-Issue hierarchy counts
  const byType = {};
  const byContact = {};
  const byCI = {};
  const byMonth = {};
  const byStatus = {};

  tickets.forEach(t => {
    // Type hierarchy
    const typeName = typePl[t.ticketType] || `Type #${t.ticketType || 'Unknown'}`;
    const issueName = issuePl[t.issueType] || (t.issueType ? `Issue #${t.issueType}` : 'No Issue');
    const subIssueName = subIssuePl[t.subIssueType] || (t.subIssueType ? `Sub #${t.subIssueType}` : 'No Sub-Issue');

    if (!byType[typeName]) byType[typeName] = { count: 0, issues: {} };
    byType[typeName].count++;
    if (!byType[typeName].issues[issueName]) byType[typeName].issues[issueName] = { count: 0, subIssues: {} };
    byType[typeName].issues[issueName].count++;
    byType[typeName].issues[issueName].subIssues[subIssueName] =
      (byType[typeName].issues[issueName].subIssues[subIssueName] || 0) + 1;

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

  // Build compact output
  const typeHierarchy = Object.entries(byType)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([type, data]) => ({
      type,
      count: data.count,
      issues: Object.entries(data.issues)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 15)
        .map(([issue, iData]) => ({
          issue,
          count: iData.count,
          subIssues: Object.entries(iData.subIssues)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([sub, count]) => ({ subIssue: sub, count }))
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
- Ticket counts by Type > Issue Type > Sub-Issue Type hierarchy
- Top ticket-submitting contacts and their companies
- Top configuration items generating tickets
- Monthly ticket volume trends
- Status distribution

When answering questions:
1. Reference specific numbers from the data
2. Calculate percentages and ratios where helpful
3. Identify outliers and anomalies (e.g., a single contact submitting 30% of tickets)
4. Suggest actionable next steps (e.g., "Consider creating a knowledge base article for [issue type] since it accounts for X% of tickets")
5. Format tables in markdown for easy reading
6. If the data doesn't contain enough information to answer, say so clearly

Do NOT make up ticket data. Only reference numbers present in the provided dataset.`;
