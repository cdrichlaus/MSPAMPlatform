// Autotask API proxy with pagination support

import { jsonResponse } from './index.js';

/**
 * Extract Autotask credentials from request headers
 */
function getAutotaskCreds(request) {
  const baseUrl = request.headers.get('X-Autotask-BaseUrl');
  const username = request.headers.get('X-Autotask-Username');
  const secret = request.headers.get('X-Autotask-Secret');
  const integrationCode = request.headers.get('X-Autotask-IntegrationCode');

  if (!baseUrl || !username || !secret || !integrationCode) {
    throw new Error('Missing Autotask credentials. Please configure them in Settings.');
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), username, secret, integrationCode };
}

/**
 * Build Autotask API headers
 */
function autotaskHeaders(creds) {
  return {
    'Content-Type': 'application/json',
    'ApiIntegrationCode': creds.integrationCode,
    'UserName': creds.username,
    'Secret': creds.secret
  };
}

/**
 * Fetch all pages from an Autotask query endpoint
 */
async function fetchAllPages(url, headers) {
  const allItems = [];
  let nextUrl = url;

  while (nextUrl) {
    const resp = await fetch(nextUrl, { headers });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Autotask API error (${resp.status}): ${body}`);
    }

    const data = await resp.json();
    if (data.items) {
      allItems.push(...data.items);
    }
    nextUrl = data.pageDetails?.nextPageUrl || null;
  }

  return allItems;
}

/**
 * Route Autotask API requests
 */
export async function handleAutotask(path, request, env) {
  const creds = getAutotaskCreds(request);
  const headers = autotaskHeaders(creds);

  // Test connection
  if (path === '/api/autotask/test') {
    const url = `${creds.baseUrl}/v1.0/Companies/query?search=${encodeURIComponent(JSON.stringify({
      filter: [{ op: 'gte', field: 'id', value: 0 }]
    }))}&MaxRecords=1`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Autotask connection failed (${resp.status}): ${body}`);
    }
    return jsonResponse({ success: true, message: 'Connected to Autotask' });
  }

  // Fetch tickets
  if (path === '/api/autotask/tickets') {
    const body = request.method === 'POST' ? await request.json() : {};
    const filter = [];

    if (body.dateFrom) {
      filter.push({ op: 'gte', field: 'createDate', value: body.dateFrom });
    }
    if (body.dateTo) {
      filter.push({ op: 'lte', field: 'createDate', value: body.dateTo });
    }
    if (body.companyId) {
      filter.push({ op: 'eq', field: 'companyID', value: parseInt(body.companyId) });
    }

    // Default: if no filters, get last 90 days
    if (filter.length === 0) {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      filter.push({ op: 'gte', field: 'createDate', value: ninetyDaysAgo });
    }

    const search = JSON.stringify({ filter });
    const url = `${creds.baseUrl}/v1.0/Tickets/query?search=${encodeURIComponent(search)}`;

    const items = await fetchAllPages(url, headers);
    return jsonResponse({ items, count: items.length });
  }

  // Fetch picklists (field definitions)
  if (path === '/api/autotask/picklists') {
    const url = `${creds.baseUrl}/v1.0/Tickets/entityInformation/fields`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`Failed to fetch picklists: ${resp.status}`);
    }

    const data = await resp.json();
    const fields = data.fields || [];
    const picklists = {};

    for (const field of fields) {
      if (['ticketType', 'issueType', 'subIssueType'].includes(field.name) && field.picklistValues) {
        picklists[field.name] = {};
        for (const pv of field.picklistValues) {
          picklists[field.name][pv.value] = pv.label;
        }
      }
    }

    return jsonResponse(picklists);
  }

  // Batch resolve contacts
  if (path === '/api/autotask/contacts') {
    const body = await request.json();
    const ids = body.ids || [];
    const contactMap = {};

    // Fetch in batches of 50
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const filter = batch.map(id => ({ op: 'eq', field: 'id', value: id }));
      const search = JSON.stringify({ filter, op: 'or' });
      const url = `${creds.baseUrl}/v1.0/Contacts/query?search=${encodeURIComponent(search)}`;

      try {
        const items = await fetchAllPages(url, headers);
        for (const contact of items) {
          contactMap[contact.id] = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || `Contact #${contact.id}`;
        }
      } catch {
        // If batch fails, map IDs as-is
        batch.forEach(id => { contactMap[id] = contactMap[id] || `Contact #${id}`; });
      }
    }

    return jsonResponse(contactMap);
  }

  // Batch resolve configuration items
  if (path === '/api/autotask/configitems') {
    const body = await request.json();
    const ids = body.ids || [];
    const ciMap = {};

    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const filter = batch.map(id => ({ op: 'eq', field: 'id', value: id }));
      const search = JSON.stringify({ filter, op: 'or' });
      const url = `${creds.baseUrl}/v1.0/ConfigurationItems/query?search=${encodeURIComponent(search)}`;

      try {
        const items = await fetchAllPages(url, headers);
        for (const ci of items) {
          ciMap[ci.id] = ci.referenceTitle || ci.rmmDeviceAuditDescription || `CI #${ci.id}`;
        }
      } catch {
        batch.forEach(id => { ciMap[id] = ciMap[id] || `CI #${id}`; });
      }
    }

    return jsonResponse(ciMap);
  }

  return jsonResponse({ error: 'Unknown Autotask endpoint' }, 404);
}
