/* Best-effort per-IP rate limiting.

   LIMITATION, stated plainly: serverless instances are ephemeral and not
   shared, so this counter resets when an instance recycles and does not see
   traffic handled by a sibling instance. It stops casual abuse from one
   client; it is not a hard quota. For a real quota put the counter in a shared
   store (Upstash Redis, Vercel KV, Cloudflare KV) behind this same interface.
*/
'use strict';

const buckets = new Map();
const WINDOW_MS = 60 * 60 * 1000;

function take(key, limit) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= WINDOW_MS) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > 5000) {               // keep memory bounded
    for (const [k, v] of buckets) {
      if (now - v.start >= WINDOW_MS) buckets.delete(k);
      if (buckets.size <= 2500) break;
    }
  }
  const remaining = Math.max(0, limit - b.count);
  const resetIn = Math.ceil((b.start + WINDOW_MS - now) / 1000);
  return { allowed: b.count <= limit, remaining, resetIn, used: b.count };
}

module.exports = { take };
