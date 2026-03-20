// Proxy client - all API calls go through the Cloudflare Worker

import { getSettings, getAutotaskBaseUrl } from './config.js';

/**
 * Make a request to the Cloudflare Worker proxy
 */
async function proxyFetch(path, options = {}) {
  const settings = getSettings();
  const workerUrl = settings.worker.url.replace(/\/+$/, '');

  if (!workerUrl) {
    throw new Error('Worker URL not configured. Please visit Settings.');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetch(`${workerUrl}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const body = await response.text();
    let message;
    try {
      message = JSON.parse(body).error || body;
    } catch {
      message = body;
    }
    throw new Error(`API error (${response.status}): ${message}`);
  }

  return response.json();
}

/**
 * Build Autotask credential headers from current settings
 */
function autotaskHeaders() {
  const settings = getSettings();
  return {
    'X-Autotask-BaseUrl': getAutotaskBaseUrl(settings),
    'X-Autotask-Username': settings.autotask.username,
    'X-Autotask-Secret': settings.autotask.secret,
    'X-Autotask-IntegrationCode': settings.autotask.integrationCode
  };
}

/**
 * Build LLM headers from current settings
 */
function llmHeaders() {
  const settings = getSettings();
  return {
    'X-LLM-EndpointUrl': settings.llm.endpointUrl,
    'X-LLM-ApiKey': settings.llm.apiKey,
    'X-LLM-Model': settings.llm.model
  };
}

/**
 * Test Autotask connection
 */
export async function testAutotaskConnection() {
  return proxyFetch('/api/autotask/test', {
    method: 'POST',
    headers: autotaskHeaders()
  });
}

/**
 * Test LLM connection
 */
export async function testLLMConnection() {
  return proxyFetch('/api/llm/test', {
    method: 'POST',
    headers: llmHeaders()
  });
}

/**
 * Fetch tickets from Autotask (with optional filters)
 */
export async function fetchTickets(filters = {}) {
  return proxyFetch('/api/autotask/tickets', {
    method: 'POST',
    headers: autotaskHeaders(),
    body: JSON.stringify(filters)
  });
}

/**
 * Fetch picklist values for ticket fields
 */
export async function fetchPicklists() {
  return proxyFetch('/api/autotask/picklists', {
    method: 'POST',
    headers: autotaskHeaders()
  });
}

/**
 * Batch-resolve contact IDs to names
 */
export async function fetchContacts(ids) {
  return proxyFetch('/api/autotask/contacts', {
    method: 'POST',
    headers: autotaskHeaders(),
    body: JSON.stringify({ ids })
  });
}

/**
 * Batch-resolve configuration item IDs to names
 */
export async function fetchConfigItems(ids) {
  return proxyFetch('/api/autotask/configitems', {
    method: 'POST',
    headers: autotaskHeaders(),
    body: JSON.stringify({ ids })
  });
}

/**
 * Send chat completion to LLM
 */
export async function chatCompletion(messages) {
  return proxyFetch('/api/llm/chat', {
    method: 'POST',
    headers: llmHeaders(),
    body: JSON.stringify({ messages })
  });
}
