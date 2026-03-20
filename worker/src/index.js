// Cloudflare Worker entry point - router + CORS

import { handleAutotask } from './autotask.js';
import { handleLLM } from './llm.js';

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(request, env, new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const path = url.pathname;

    let response;
    try {
      if (path.startsWith('/api/autotask/')) {
        response = await handleAutotask(path, request, env);
      } else if (path.startsWith('/api/llm/')) {
        response = await handleLLM(path, request, env);
      } else {
        response = jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (err) {
      response = jsonResponse({ error: err.message || 'Internal server error' }, 500);
    }

    return corsResponse(request, env, response);
  }
};

/**
 * Wrap a response with CORS headers
 */
function corsResponse(request, env, response) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());

  const headers = new Headers(response.headers);
  if (allowed.includes(origin) || allowed.includes('*')) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Autotask-BaseUrl, X-Autotask-Username, X-Autotask-Secret, X-Autotask-IntegrationCode, X-LLM-EndpointUrl, X-LLM-ApiKey, X-LLM-Model');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Helper to create JSON responses
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
