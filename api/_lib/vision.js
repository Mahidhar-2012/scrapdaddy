/* Vision providers.
 *
 * One interface, two implementations, chosen with VISION_PROVIDER:
 *
 *   analyse({ dataUrl, mime, base64, prompt, maxTokens })
 *     -> { ok: true,  text, model, usage }
 *     -> { ok: false, status, body }        (caller maps this to a message)
 *
 * They differ in more than the URL: OpenAI's strict mode wants
 * additionalProperties:false and accepts ["string","null"] unions, while
 * Gemini's schema dialect does not. schemaFor() returns the right shape for
 * whichever provider is in use, so neither gets a schema it will reject.
 */
'use strict';

const { config } = require('./config');
const { fetchWithTimeout } = require('./http');

/* ---------- OpenAI: POST /v1/responses, image as a data URL ---------- */
async function openaiAnalyse({ dataUrl, prompt, schema, maxTokens }, key) {
  const res = await fetchWithTimeout(config.vision.endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: config.vision.model(),
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: dataUrl, detail: 'auto' },
        ],
      }],
      text: { format: { type: 'json_schema', name: 'scrap_assessment', schema, strict: true } },
      max_output_tokens: maxTokens,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => '') };
  const data = await res.json();
  return { ok: true, text: extractOpenAiText(data), model: data.model || config.vision.model(),
           usage: data.usage ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } : null };
}
function extractOpenAiText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const part of item.content) if (part && typeof part.text === 'string' && part.text.trim()) return part.text;
    }
  }
  if (Array.isArray(data.content)) for (const p of data.content) if (p && typeof p.text === 'string') return p.text;
  return null;
}

/* ---------- Gemini: POST /v1beta/interactions, image as raw base64 ---------- */
async function geminiAnalyse({ mime, base64, prompt, schema, maxTokens }, key) {
  const res = await fetchWithTimeout(config.vision.endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model: config.vision.model(),
      input: [
        { type: 'text', text: prompt },
        { type: 'image', data: base64, mime_type: mime },
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema },
      max_output_tokens: maxTokens,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => '') };
  const data = await res.json();
  return { ok: true, text: extractGeminiText(data), model: data.model || config.vision.model(),
           usage: data.usage ? { inputTokens: data.usage.input_tokens || data.usage.prompt_tokens || null,
                                 outputTokens: data.usage.output_tokens || data.usage.completion_tokens || null } : null };
}
function extractGeminiText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  // tolerate the older generateContent shape and minor response variations
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (typeof item === 'string' && item.trim()) return item;
      if (item && typeof item.text === 'string' && item.text.trim()) return item.text;
      if (item && Array.isArray(item.content)) {
        for (const part of item.content) if (part && typeof part.text === 'string' && part.text.trim()) return part.text;
      }
    }
  }
  const cand = data.candidates && data.candidates[0];
  if (cand && cand.content && Array.isArray(cand.content.parts)) {
    for (const p of cand.content.parts) if (p && typeof p.text === 'string' && p.text.trim()) return p.text;
  }
  return null;
}

/* ---------- Groq: OpenAI-compatible chat completions, image as a data URL ----
   Groq documents JSON mode (response_format {type:'json_object'}) for its
   vision model but not json_schema, so the shape is described in the prompt
   and enforced by validateReport() on the way back, exactly as for the others. */
async function groqAnalyse({ dataUrl, prompt, schema, maxTokens }, key) {
  const res = await fetchWithTimeout(config.vision.endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: config.vision.model(),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt + '\n\n' + schemaInstructions(schema) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => '') };
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return { ok: true, text: text || null, model: data.model || config.vision.model(),
           usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : null };
}

/** Renders a schema as plain instructions, for providers without schema mode. */
function schemaInstructions(schema) {
  const lines = Object.keys(schema.properties).map(k => {
    const p = schema.properties[k];
    const type = Array.isArray(p.type) ? p.type.filter(x => x !== 'null').join('|') : p.type;
    const enums = p.enum ? ' one of: ' + p.enum.join(', ') : '';
    const items = p.type === 'array' ? ' (array of strings)' : '';
    return `- "${k}" (${type})${items}${enums}${p.description ? ' — ' + p.description : ''}`;
  });
  return 'Reply with JSON only. No prose, no code fence. Use exactly these keys:\n' + lines.join('\n') +
         '\nEvery key must be present. Use an empty string or an empty array where you have nothing to say.';
}

/* ---------- provider-appropriate schema ---------- */
function schemaFor(provider, base) {
  if (provider === 'openai') return base;
  // Neither Gemini nor Groq takes OpenAI's strict dialect, so flatten
  // nullable fields to plain strings. validateReport() already treats an empty
  // string as "none", so the result is identical.
  const props = {};
  Object.keys(base.properties).forEach(k => {
    const p = Object.assign({}, base.properties[k]);
    if (Array.isArray(p.type)) p.type = p.type.find(t => t !== 'null') || 'string';
    delete p.additionalProperties;
    props[k] = p;
  });
  return { type: 'object', properties: props, required: base.required.slice() };
}

async function analyse(args) {
  const key = config.vision.key();
  if (!key.ok) return { ok: false, status: 0, notConfigured: true, body: key.reason };
  const provider = config.vision.provider();
  const payload = Object.assign({}, args, { schema: schemaFor(provider, args.schema) });
  if (provider === 'gemini') return geminiAnalyse(payload, key.value);
  if (provider === 'openai') return openaiAnalyse(payload, key.value);
  return groqAnalyse(payload, key.value);
}

module.exports = { analyse, schemaFor };
