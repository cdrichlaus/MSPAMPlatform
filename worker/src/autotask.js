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
 * Build an OR filter for multiple IDs on a given field.
 * Autotask REST API format: { filter: [ { op: 'or', items: [ {op:'eq',field,value}, ... ] } ] }
 */
function buildOrFilter(field, ids, additionalFilters = []) {
  const orItems = ids.map(id => ({ op: 'eq', field, value: id }));
  return {
    filter: [
      ...additionalFilters,
      { op: 'or', items: orItems }
    ]
  };
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

  // Fetch all active companies (for dropdown)
  if (path === '/api/autotask/companies') {
    const search = JSON.stringify({
      filter: [{ op: 'eq', field: 'isActive', value: true }]
    });
    const url = `${creds.baseUrl}/v1.0/Companies/query?search=${encodeURIComponent(search)}`;
    const items = await fetchAllPages(url, headers);

    const companies = items
      .map(c => ({ id: c.id, name: c.companyName }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return jsonResponse({ items: companies });
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
      if (['ticketType', 'issueType', 'subIssueType', 'status', 'priority'].includes(field.name) && field.picklistValues) {
        picklists[field.name] = {};
        for (const pv of field.picklistValues) {
          picklists[field.name][pv.value] = pv.label;
        }
      }
    }

    return jsonResponse(picklists);
  }

  // Batch resolve contacts - fetch one at a time to avoid OR filter issues
  if (path === '/api/autotask/contacts') {
    const body = await request.json();
    const ids = body.ids || [];
    const contactMap = {};

    // Fetch in batches using proper OR filter format
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const search = JSON.stringify(buildOrFilter('id', batch));
      const url = `${creds.baseUrl}/v1.0/Contacts/query?search=${encodeURIComponent(search)}`;

      try {
        const items = await fetchAllPages(url, headers);
        for (const contact of items) {
          contactMap[contact.id] = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || `Contact #${contact.id}`;
        }
      } catch (err) {
        // If OR filter fails, fall back to fetching one by one
        for (const id of batch) {
          if (contactMap[id]) continue;
          try {
            const singleSearch = JSON.stringify({ filter: [{ op: 'eq', field: 'id', value: id }] });
            const singleUrl = `${creds.baseUrl}/v1.0/Contacts/query?search=${encodeURIComponent(singleSearch)}`;
            const items = await fetchAllPages(singleUrl, headers);
            if (items.length > 0) {
              const c = items[0];
              contactMap[c.id] = `${c.firstName || ''} ${c.lastName || ''}`.trim() || `Contact #${c.id}`;
            }
          } catch {
            contactMap[id] = `Contact #${id}`;
          }
        }
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
      const search = JSON.stringify(buildOrFilter('id', batch));
      const url = `${creds.baseUrl}/v1.0/ConfigurationItems/query?search=${encodeURIComponent(search)}`;

      try {
        const items = await fetchAllPages(url, headers);
        for (const ci of items) {
          ciMap[ci.id] = ci.referenceTitle || ci.rmmDeviceAuditDescription || `CI #${ci.id}`;
        }
      } catch {
        // Fall back to one-by-one
        for (const id of batch) {
          if (ciMap[id]) continue;
          try {
            const singleSearch = JSON.stringify({ filter: [{ op: 'eq', field: 'id', value: id }] });
            const singleUrl = `${creds.baseUrl}/v1.0/ConfigurationItems/query?search=${encodeURIComponent(singleSearch)}`;
            const items = await fetchAllPages(singleUrl, headers);
            if (items.length > 0) {
              const ci = items[0];
              ciMap[ci.id] = ci.referenceTitle || ci.rmmDeviceAuditDescription || `CI #${ci.id}`;
            }
          } catch {
            ciMap[id] = `CI #${id}`;
          }
        }
      }
    }

    return jsonResponse(ciMap);
  }

  // Fetch time entries (for ticket variance and profitability)
  if (path === '/api/autotask/timeentries') {
    const body = request.method === 'POST' ? await request.json() : {};
    const dateFilters = [];

    if (body.dateFrom) {
      dateFilters.push({ op: 'gte', field: 'dateWorked', value: body.dateFrom });
    }
    if (body.dateTo) {
      dateFilters.push({ op: 'lte', field: 'dateWorked', value: body.dateTo });
    }

    if (body.ticketIds && body.ticketIds.length > 0) {
      const allEntries = [];
      for (let i = 0; i < body.ticketIds.length; i += 50) {
        const batch = body.ticketIds.slice(i, i + 50);
        const search = JSON.stringify(buildOrFilter('ticketID', batch, dateFilters));
        const url = `${creds.baseUrl}/v1.0/TimeEntries/query?search=${encodeURIComponent(search)}`;
        try {
          const items = await fetchAllPages(url, headers);
          allEntries.push(...items);
        } catch {
          // Skip failed batch
        }
      }
      return jsonResponse({ items: allEntries, count: allEntries.length });
    }

    if (body.contractIds && body.contractIds.length > 0) {
      const allEntries = [];
      for (let i = 0; i < body.contractIds.length; i += 50) {
        const batch = body.contractIds.slice(i, i + 50);
        const search = JSON.stringify(buildOrFilter('contractID', batch, dateFilters));
        const url = `${creds.baseUrl}/v1.0/TimeEntries/query?search=${encodeURIComponent(search)}`;
        try {
          const items = await fetchAllPages(url, headers);
          allEntries.push(...items);
        } catch {
          // Skip failed batch
        }
      }
      return jsonResponse({ items: allEntries, count: allEntries.length });
    }

    // Default: date-filtered time entries
    const filter = [...dateFilters];
    if (filter.length === 0) {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      filter.push({ op: 'gte', field: 'dateWorked', value: ninetyDaysAgo });
    }

    const search = JSON.stringify({ filter });
    const url = `${creds.baseUrl}/v1.0/TimeEntries/query?search=${encodeURIComponent(search)}`;
    const items = await fetchAllPages(url, headers);
    return jsonResponse({ items, count: items.length });
  }

  // Fetch contracts (with optional company filter)
  if (path === '/api/autotask/contracts') {
    const body = request.method === 'POST' ? await request.json() : {};
    const filter = [];

    if (body.companyId) {
      filter.push({ op: 'eq', field: 'companyID', value: parseInt(body.companyId) });
    }

    // Always include active status filter
    filter.push({ op: 'eq', field: 'status', value: 1 }); // 1 = Active

    const search = JSON.stringify({ filter });
    const url = `${creds.baseUrl}/v1.0/Contracts/query?search=${encodeURIComponent(search)}`;
    const items = await fetchAllPages(url, headers);
    return jsonResponse({ items, count: items.length });
  }

  // Fetch contract field picklists (for LOB, contract type, etc.)
  if (path === '/api/autotask/contractpicklists') {
    const url = `${creds.baseUrl}/v1.0/Contracts/entityInformation/fields`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`Failed to fetch contract picklists: ${resp.status}`);
    }

    const data = await resp.json();
    const fields = data.fields || [];
    const picklists = {};

    for (const field of fields) {
      if (['contractType', 'status', 'billingPreference'].includes(field.name) && field.picklistValues) {
        picklists[field.name] = {};
        for (const pv of field.picklistValues) {
          picklists[field.name][pv.value] = pv.label;
        }
      }
    }

    return jsonResponse(picklists);
  }

  // Fetch resources (for cost rates)
  if (path === '/api/autotask/resources') {
    const search = JSON.stringify({
      filter: [{ op: 'eq', field: 'isActive', value: true }]
    });
    const url = `${creds.baseUrl}/v1.0/Resources/query?search=${encodeURIComponent(search)}`;
    const items = await fetchAllPages(url, headers);

    const resources = items.map(r => ({
      id: r.id,
      name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      email: r.email,
      internalCost: r.internalCost || 0
    }));

    return jsonResponse({ items: resources });
  }

  // Fetch roles (for billing rates)
  if (path === '/api/autotask/roles') {
    const search = JSON.stringify({
      filter: [{ op: 'eq', field: 'isActive', value: true }]
    });
    const url = `${creds.baseUrl}/v1.0/Roles/query?search=${encodeURIComponent(search)}`;
    const items = await fetchAllPages(url, headers);

    const roles = items.map(r => ({
      id: r.id,
      name: r.name,
      hourlyRate: r.hourlyRate || 0
    }));

    return jsonResponse({ items: roles });
  }

  // Fetch Lines of Business (Billing): "Division > Subdivision"
  // Joins BusinessDivisions + BusinessSubdivisions via BusinessDivisionSubdivisions
  if (path === '/api/autotask/businessdivisions') {
    const allFilter = JSON.stringify({ filter: [{ op: 'gte', field: 'id', value: 0 }] });

    try {
      // Fetch all three entities in parallel
      const [joinItems, divItems, subItems] = await Promise.all([
        fetchAllPages(`${creds.baseUrl}/v1.0/BusinessDivisionSubdivisions/query?search=${encodeURIComponent(allFilter)}`, headers),
        fetchAllPages(`${creds.baseUrl}/v1.0/BusinessDivisions/query?search=${encodeURIComponent(allFilter)}`, headers),
        fetchAllPages(`${creds.baseUrl}/v1.0/BusinessSubdivisions/query?search=${encodeURIComponent(allFilter)}`, headers)
      ]);

      // Build lookup maps
      const divMap = {};
      divItems.forEach(d => { divMap[d.id] = d.name || d.divisionName || `Division #${d.id}`; });
      const subMap = {};
      subItems.forEach(s => { subMap[s.id] = s.name || s.subdivisionName || `Subdivision #${s.id}`; });

      // Join: each BusinessDivisionSubdivision has businessDivisionID + businessSubdivisionID
      const lobs = joinItems.map(j => {
        const divName = divMap[j.businessDivisionID] || `Division #${j.businessDivisionID}`;
        const subName = subMap[j.businessSubdivisionID] || `Subdivision #${j.businessSubdivisionID}`;
        return {
          id: j.id,
          name: `${divName} > ${subName}`,
          divisionId: j.businessDivisionID,
          subdivisionId: j.businessSubdivisionID
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      return jsonResponse({ items: lobs });
    } catch {
      // Fallback: extract LOB IDs from active contracts
      try {
        const search = JSON.stringify({ filter: [{ op: 'eq', field: 'status', value: 1 }] });
        const url = `${creds.baseUrl}/v1.0/Contracts/query?search=${encodeURIComponent(search)}`;
        const contracts = await fetchAllPages(url, headers);

        const lobIds = [...new Set(
          contracts.map(c => c.businessDivisionSubdivisionID).filter(Boolean)
        )];

        const lobs = lobIds.map(id => ({ id, name: `Line of Business #${id}` }));
        return jsonResponse({ items: lobs });
      } catch {
        return jsonResponse({ items: [] });
      }
    }
  }

  return jsonResponse({ error: 'Unknown Autotask endpoint' }, 404);
}
