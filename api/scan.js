/* POST /api/scan
   Body: { image: "data:image/jpeg;base64,...", knownWeightKg?, locality?, materials[] }
   Sends the photo to OpenAI's Responses API with a strict JSON schema, then
   validates the reply again before returning it. No price is produced here. */
'use strict';

const { config } = require('./_lib/config');
const { handler, send, fail, readJson, clientIp, fetchWithTimeout, upstreamMessage, upstreamCode } = require('./_lib/http');
const { take } = require('./_lib/ratelimit');
const { scanSchema, buildPrompt, validateReport } = require('./_lib/scanSchema');
const { analyse } = require('./_lib/vision');

const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

module.exports = handler(['POST'], async (req, res) => {
  const key = config.vision.key();
  if (!key.ok) {
    return fail(res, 503, 'Photo analysis is not configured on this deployment.', {
      code: 'not_configured', detail: key.reason,
    });
  }

  const limit = take('scan:' + clientIp(req), config.limits.scanPerHour);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.resetIn));
    return fail(res, 429, `You have used this hour's ${config.limits.scanPerHour} scans. Try again in ${Math.ceil(limit.resetIn / 60)} minutes.`, { code: 'rate_limited' });
  }

  let body;
  try { body = await readJson(req, config.limits.maxImageBytes * 2); }
  catch (e) { return fail(res, e.status || 400, e.status === 413 ? 'That image is too large.' : 'Could not read the request.'); }

  const image = typeof body.image === 'string' ? body.image.trim() : '';
  const m = DATA_URL.exec(image);
  if (!m) return fail(res, 400, 'Send a JPEG, PNG, WebP or GIF image as a data URL.', { code: 'bad_image' });

  const bytes = Math.ceil(m[2].replace(/\s/g, '').length * 0.75);
  if (bytes > config.limits.maxImageBytes) {
    return fail(res, 413, `That image is ${(bytes / 1048576).toFixed(1)} MB. Please use one under ${(config.limits.maxImageBytes / 1048576).toFixed(0)} MB.`, { code: 'too_large' });
  }

  const materials = Array.isArray(body.materials) && body.materials.length
    ? body.materials.filter(s => typeof s === 'string').slice(0, 40)
    : ['copper', 'brass', 'aluminium', 'iron', 'plastic', 'paper', 'cardboard', 'ac', 'fridge'];
  const weight = Number(body.knownWeightKg) > 0 ? Number(body.knownWeightKg) : null;
  const locality = typeof body.locality === 'string' ? body.locality.slice(0, 120) : null;

  const result = await analyse({
    dataUrl: image,
    mime: m[1],
    base64: m[2].replace(/\s/g, ''),
    prompt: buildPrompt(materials, weight, locality),
    schema: scanSchema,
    maxTokens: 900,
  }).catch(e => ({ ok: false, status: 0, thrown: e }));

  const label = config.vision.label();

  if (!result.ok) {
    if (result.thrown) {
      console.error('[scan] ' + label + ' transport error:', result.thrown && result.thrown.name);
      return fail(res, 504, result.thrown.name === 'AbortError'
        ? 'The analysis took too long. Please try again with a smaller photo.'
        : 'Could not reach the image analysis service.');
    }
    console.error('[scan] ' + label, result.status, String(result.body || '').slice(0, 400));
    const code = upstreamCode(result.status, result.body);
    return fail(res, result.status === 429 ? 429 : 502, upstreamMessage(result.status, label, result.body), { code });
  }

  if (!result.text) {
    console.error('[scan] ' + label + ' returned no text');
    return fail(res, 502, 'The analysis came back empty. Please try another photo.');
  }

  let parsed;
  try { parsed = JSON.parse(result.text); }
  catch {
    // some models wrap JSON in a code fence
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(result.text);
    try { parsed = JSON.parse(fenced ? fenced[1] : result.text); }
    catch { return fail(res, 502, 'The analysis was not in the expected format. Please try again.'); }
  }

  parsed.__weightSupplied = !!weight;
  const checked = validateReport(parsed);
  if (!checked.ok) return fail(res, 502, checked.error);

  send(res, 200, {
    report: checked.report,
    provider: config.vision.provider(),
    model: result.model,
    usage: result.usage,
    scansLeftThisHour: limit.remaining,
  });
});
