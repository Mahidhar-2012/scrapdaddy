/* The contract for a scrap photo analysis.

   The schema is sent to the model to force structured output, and the reply is
   validated against it again here before it reaches the browser. The model is
   never asked for a weight, a purity, an industry grade or a price: none of
   those can be read off an ordinary photograph, so the schema has no field for
   them. Confidence is a coarse label with a stated reason, not a percentage.
*/
'use strict';

const CATEGORIES = ['metals', 'plastics', 'paper', 'ewaste', 'mixed', 'not_scrap', 'unclear'];
const CONFIDENCE = ['low', 'medium', 'high'];
const QUALITY = ['good', 'blurry', 'too_dark', 'too_far', 'cluttered', 'partial'];

const scanSchema = {
  type: 'object',
  properties: {
    materialCategory: { type: 'string', enum: CATEGORIES,
      description: 'Best single category for the dominant material. Use "mixed" when several materials share the frame, "unclear" when the photo does not support a call, "not_scrap" when this is not recyclable scrap.' },
    materialSubtype: { type: ['string', 'null'],
      description: 'More specific material if the image genuinely supports it, e.g. "copper wire", "HDPE containers", "corrugated cardboard". Null when it does not.' },
    priceKey: { type: ['string', 'null'],
      description: 'The closest key from the supplied material list, or null if none fits.' },
    confidence: { type: 'string', enum: CONFIDENCE },
    confidenceReason: { type: 'string', description: 'One sentence on why the confidence is what it is.' },
    visibleItems: { type: 'array', items: { type: 'string' }, description: 'Distinct items you can actually see. Empty if none are identifiable.' },
    condition: { type: 'string', description: 'Observable condition: rust, damage, wear, how it is bundled or sorted.' },
    contamination: { type: 'array', items: { type: 'string' },
      description: 'Visible non-target material: attached plastic, food residue, mixed-in items. Empty array if none is visible.' },
    photoQuality: { type: 'string', enum: QUALITY },
    limitations: { type: 'array', items: { type: 'string' },
      description: 'What this photo cannot establish. Always mention that weight, alloy purity and industry grade cannot be judged from a photo.' },
    needFromUser: { type: 'array', items: { type: 'string' },
      description: 'Specific things the person should supply or re-photograph for a firmer answer.' },
    quantityAssessment: { type: 'string',
      description: 'What can honestly be said about quantity from the image, in words. Never state a weight in kilograms unless the user supplied one.' },
    safetyNotes: { type: 'array', items: { type: 'string' },
      description: 'Handling warnings such as sharp edges, refrigerant, batteries, CRT glass. Empty array if none apply.' },
    summary: { type: 'string', description: 'Two sentences at most, plain language, for the person selling the item.' },
  },
  required: ['materialCategory', 'materialSubtype', 'priceKey', 'confidence', 'confidenceReason',
             'visibleItems', 'condition', 'contamination', 'photoQuality', 'limitations',
             'needFromUser', 'quantityAssessment', 'safetyNotes', 'summary'],
  additionalProperties: false,
};

function buildPrompt(materials, knownWeightKg, locality) {
  return [
    'You are a scrap material assessor for ScrapDaddy, an Indian scrap marketplace.',
    'Look at the photograph and describe only what you can actually see.',
    '',
    'Rules you must follow:',
    '- Never estimate weight in kilograms from the image. If the user supplied a weight, you may refer to it, but do not invent one.',
    '- Never state alloy purity, chemical composition or an industry grade such as HMS-1. These cannot be judged from a photo.',
    '- Never give a price or a monetary value. Pricing is handled elsewhere.',
    '- Never give a numeric confidence percentage. Use low, medium or high and say why.',
    '- If the photo is blurry, dark, distant or ambiguous, say so and set confidence to low.',
    '- If two materials look similar (for example aluminium against galvanised steel, or brass against bronze), say which it could be and what would tell them apart.',
    '- If the image is not recyclable scrap at all, set materialCategory to "not_scrap".',
    '',
    'Pick priceKey from exactly this list, or null if nothing fits: ' + materials.join(', ') + '.',
    knownWeightKg ? `The user says the quantity is about ${knownWeightKg} kg. Treat that as their claim, not as verified.` : 'The user has not given a weight.',
    locality ? `The item is in ${locality}, India.` : '',
    '',
    'Answer only with the structured object.',
  ].filter(Boolean).join('\n');
}

/** Validates and normalises a model reply. Returns {ok, report} or {ok:false, error}. */
function validateReport(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The analysis came back empty.' };
  const out = {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 600) : '');
  const arr = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 300)).slice(0, 8) : [];

  out.materialCategory = CATEGORIES.indexOf(raw.materialCategory) >= 0 ? raw.materialCategory : 'unclear';
  out.materialSubtype = raw.materialSubtype == null ? null : str(raw.materialSubtype, 120) || null;
  out.priceKey = raw.priceKey == null ? null : str(raw.priceKey, 40) || null;
  out.confidence = CONFIDENCE.indexOf(raw.confidence) >= 0 ? raw.confidence : 'low';
  out.confidenceReason = str(raw.confidenceReason, 300);
  out.visibleItems = arr(raw.visibleItems);
  out.condition = str(raw.condition, 400);
  out.contamination = arr(raw.contamination);
  out.photoQuality = QUALITY.indexOf(raw.photoQuality) >= 0 ? raw.photoQuality : 'good';
  out.limitations = arr(raw.limitations);
  out.needFromUser = arr(raw.needFromUser);
  out.quantityAssessment = str(raw.quantityAssessment, 400);
  out.safetyNotes = arr(raw.safetyNotes);
  out.summary = str(raw.summary, 400);

  if (!out.summary && !out.condition && !out.visibleItems.length) {
    return { ok: false, error: 'The analysis did not contain anything usable. Please try another photo.' };
  }
  // A weight in kilograms must never come back as a model invention.
  if (/\b\d+(\.\d+)?\s?(kg|kilo|kilogram)/i.test(out.quantityAssessment) && !raw.__weightSupplied) {
    out.quantityAssessment = 'Quantity cannot be judged from the photograph. Please weigh the material or let the collector weigh it on arrival.';
  }
  if (out.limitations.length === 0) {
    out.limitations = ['Weight, alloy purity and industry grade cannot be judged from a photograph.'];
  }
  return { ok: true, report: out };
}

module.exports = { scanSchema, buildPrompt, validateReport, CATEGORIES, CONFIDENCE, QUALITY };
