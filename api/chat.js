/* POST /api/chat
   Body: { messages: [{role,content}], context: {...} }
   Groq chat completions for the ScrapDaddy help assistant. The context is the
   caller's own summary of their session — it never contains another user's
   data, because the browser only ever builds it from the signed-in user. */
'use strict';

const { config } = require('./_lib/config');
const { handler, send, fail, readJson, clientIp, fetchWithTimeout, upstreamMessage, upstreamCode } = require('./_lib/http');
const { take } = require('./_lib/ratelimit');

const MAX_TURNS = 16;
const MAX_CHARS = 1500;

const SYSTEM = `You are the ScrapDaddy help assistant. ScrapDaddy is an Indian marketplace that connects
households, local scrap vendors (kabadiwalas) and recycling factories.

What the product actually does today:
- Households list scrap with a photo, either at the published rate or inviting bids, and book a free pickup.
- A verified vendor accepts the job, weighs the material on a digital scale, pays the household, and adds it to their hub.
- Vendors bale hub inventory into multi-tonne lots and publish them to factories.
- Factories buy lots and see a GST and TCS breakdown with the HSN code. Metals and e-waste are 18%, paper and plastics 5%.
- Vendors have subscription plans: Starter (free, 10 pickups a month, cannot publish lots), Growth (Rs 499 a month,
  60 pickups, can publish lots, priority placement) and Pro (Rs 1499 a month, unlimited).
- Scrap rates in the app are indicative reference prices with a named source and an update time. They are not a live market feed.
- There is a photo analysis feature that describes what is visible in a picture of scrap.

How to answer:
- Be brief and practical. Two or three short sentences is usually enough. Plain English, no jargon.
- Use the context block for the person's own situation. It is the only account data you have.
- If you do not know something, say so and suggest where in the app to look.
- Never invent a price, a subscription status, a booking, a payment, an order or a weight. If the context does not
  contain it, say you cannot see it rather than guessing.
- Never claim a pickup has been scheduled or a payment has been taken. You cannot perform actions; you can only explain
  where to do them.
- Rates you quote must come from the context. Say they are indicative.
- You cannot judge weight, purity or grade from a photo, and neither can the scanner. Say so if asked.
- For anything about taxes, say it is indicative and suggest checking with their accountant.`;

module.exports = handler(['POST'], async (req, res) => {
  const key = config.chat.key();
  if (!key.ok) {
    return fail(res, 503, 'The assistant is not configured on this deployment.', {
      code: 'not_configured', detail: key.reason,
    });
  }

  const limit = take('chat:' + clientIp(req), config.limits.chatPerHour);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.resetIn));
    return fail(res, 429, `You have reached this hour's message limit. Try again in ${Math.ceil(limit.resetIn / 60)} minutes.`, { code: 'rate_limited' });
  }

  let body;
  try { body = await readJson(req, 256 * 1024); }
  catch (e) { return fail(res, e.status || 400, 'Could not read the request.'); }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (!messages.length) return fail(res, 400, 'Send at least one message.');

  let contextBlock = '';
  if (body.context && typeof body.context === 'object') {
    try { contextBlock = JSON.stringify(body.context).slice(0, 4000); } catch {}
  }

  const payload = {
    model: config.chat.model(),
    messages: [
      { role: 'system', content: SYSTEM },
      contextBlock ? { role: 'system', content: 'Context for this person (the only account data you have):\n' + contextBlock } : null,
      ...messages,
    ].filter(Boolean),
    temperature: 0.3,
    max_tokens: 500,
  };

  let upstream;
  try {
    upstream = await fetchWithTimeout(config.chat.endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key.value },
      body: JSON.stringify(payload),
    }, 25000);
  } catch (e) {
    console.error('[chat] upstream error:', e && e.name);
    return fail(res, 504, e.name === 'AbortError' ? 'The assistant took too long to reply.' : 'Could not reach the assistant service.');
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error('[chat] groq', upstream.status, detail.slice(0, 400));
    const code = upstreamCode(upstream.status, detail);
    return fail(res, upstream.status === 429 ? 429 : 502, upstreamMessage(upstream.status, 'Groq', detail), { code });
  }

  let data;
  try { data = await upstream.json(); }
  catch { return fail(res, 502, 'The assistant sent a reply we could not read.'); }

  const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!reply || !reply.trim()) return fail(res, 502, 'The assistant did not say anything. Please try again.');

  send(res, 200, {
    reply: reply.trim(),
    model: data.model || config.chat.model(),
    messagesLeftThisHour: limit.remaining,
  });
});
