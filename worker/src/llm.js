// LLM proxy - OpenAI-compatible chat completions

import { jsonResponse } from './index.js';

/**
 * Extract LLM credentials from request headers
 */
function getLLMCreds(request) {
  const endpointUrl = request.headers.get('X-LLM-EndpointUrl');
  const apiKey = request.headers.get('X-LLM-ApiKey');
  const model = request.headers.get('X-LLM-Model');

  if (!endpointUrl || !apiKey) {
    throw new Error('Missing LLM credentials. Please configure them in Settings.');
  }

  return { endpointUrl: endpointUrl.replace(/\/+$/, ''), apiKey, model: model || 'claude-sonnet-4-20250514' };
}

/**
 * Route LLM API requests
 */
export async function handleLLM(path, request, env) {
  const creds = getLLMCreds(request);

  // Test connection
  if (path === '/api/llm/test') {
    const resp = await fetch(`${creds.endpointUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.apiKey}`
      },
      body: JSON.stringify({
        model: creds.model,
        messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        max_tokens: 10
      })
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`LLM connection failed (${resp.status}): ${body}`);
    }

    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '';
    return jsonResponse({ success: true, message: `Connected. Model replied: "${reply}"` });
  }

  // Chat completion
  if (path === '/api/llm/chat') {
    const body = await request.json();
    const messages = body.messages || [];

    if (messages.length === 0) {
      return jsonResponse({ error: 'No messages provided' }, 400);
    }

    const resp = await fetch(`${creds.endpointUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.apiKey}`
      },
      body: JSON.stringify({
        model: creds.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096
      })
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`LLM API error (${resp.status}): ${body}`);
    }

    return jsonResponse(await resp.json());
  }

  return jsonResponse({ error: 'Unknown LLM endpoint' }, 404);
}
