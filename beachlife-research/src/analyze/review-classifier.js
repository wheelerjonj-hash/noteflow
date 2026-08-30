// Guest-review classification for management-issue detection.
//
// The hard part is not sentiment — it is ATTRIBUTION. A one-star review saying
// the beach was crowded and the traffic was bad tells you nothing about the
// management company. A four-star review that says "lovely house, but it took
// three days and five texts to get someone out for the broken AC" is exactly
// the churn signal worth acting on. So every finding carries who it is about,
// and only 'management' findings reach the prospect score.

import Anthropic from '@anthropic-ai/sdk';
import { log } from '../lib/log.js';

const MODEL = 'claude-opus-5';

export const CATEGORIES = {
  responsiveness:
    'Guest could not reach management, messages went unanswered, or response was slow.',
  maintenance_delay:
    'Something broke during the stay and was not fixed promptly (AC, pool heat, appliances, wifi).',
  cleanliness:
    'Property was not clean on arrival — a turnover failure rather than wear.',
  checkin_access:
    'Check-in problems: wrong or non-working codes, no instructions, lockout, late access.',
  listing_accuracy:
    'Listing photos, description, or amenities materially misrepresented the property.',
  billing_fees:
    'Surprise fees, deposit disputes, refund or overcharge problems.',
  staffing_turnover:
    'Guest noted a change of management company, new staff, or declining service over time.',
  condition_neglect:
    'Deferred upkeep: worn, dated, damaged, mold, pests — capital neglect, not a one-off break.',
  noise_rules:
    'Poorly managed neighbouring units, rule enforcement failures, or party/noise problems.',
};

const SYSTEM_PROMPT = `You classify guest reviews of short-term vacation rentals on Anna Maria Island, Florida, for a property management company evaluating which properties are poorly managed.

Your job is to identify complaints that indicate a PROPERTY MANAGEMENT problem — something a better management company would have handled differently.

For each review, emit a finding for every issue category that genuinely applies. Most reviews are positive and should produce zero findings. Do not invent findings to fill space.

CATEGORIES:
${Object.entries(CATEGORIES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

ATTRIBUTION is the most important field. Assign it honestly:
- "management": the management company caused it or failed to resolve it (slow maintenance, unanswered messages, dirty turnover, check-in failures, billing errors).
- "property": inherent to the building or its owner's capital decisions (dated kitchen, small rooms, thin walls, no elevator). A better manager would not change this.
- "location": about the neighbourhood, beach, traffic, weather, or nearby construction.
- "guest": the reviewer's own expectations or behaviour caused the problem.
- "unclear": a real complaint whose cause cannot be determined from the text.

SEVERITY 1-5: 1 = minor annoyance mentioned in passing; 3 = materially hurt the stay; 5 = ruined the stay or went unresolved despite repeated contact.

CONFIDENCE 0-1: how certain you are the category and attribution are right. Vague grumbling gets low confidence.

EVIDENCE: quote the shortest span of the review that supports the finding, verbatim. Do not paraphrase.

Be conservative. A glowing review with one soft caveat is not a management problem. Praise for responsive management is not a finding — it is the absence of one.`;

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          review_ref: { type: 'string', description: 'The ref given in the input.' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', enum: Object.keys(CATEGORIES) },
                attribution: {
                  type: 'string',
                  enum: ['management', 'property', 'location', 'guest', 'unclear'],
                },
                severity: { type: 'integer', minimum: 1, maximum: 5 },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                evidence_quote: { type: 'string' },
              },
              required: ['category', 'attribution', 'severity', 'confidence', 'evidence_quote'],
              additionalProperties: false,
            },
          },
        },
        required: ['review_ref', 'findings'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

let client;
function getClient() {
  // Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Classify a batch of reviews.
 * @param {Array<{id: string, body: string, rating?: number, reviewed_at?: string}>} reviews
 * @returns {Promise<Array<{review_id: string, findings: Array}>>}
 */
export async function classifyReviews(reviews, { batchSize = 15 } = {}) {
  const out = [];
  for (let i = 0; i < reviews.length; i += batchSize) {
    const batch = reviews.slice(i, i + batchSize);
    out.push(...(await classifyBatch(batch)));
  }
  return out;
}

async function classifyBatch(batch) {
  const payload = batch
    .map((r, n) => {
      const meta = [r.rating != null ? `rating ${r.rating}` : null, r.reviewed_at]
        .filter(Boolean).join(', ');
      return `<review ref="r${n}"${meta ? ` meta="${meta}"` : ''}>\n${r.body.trim()}\n</review>`;
    })
    .join('\n\n');

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    // The system prompt is identical on every call; caching it makes a
    // full-corpus reclassification dramatically cheaper.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: RESULT_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Classify each review below. Return one result object per review, in order.\n\n${payload}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    log.error('classifier refused', { details: response.stop_details });
    throw new Error('Review classification refused by the model');
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Classifier returned no text block');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Classifier returned unparseable JSON: ${err.message}`);
  }

  log.debug('classified batch', {
    reviews: batch.length,
    cacheRead: response.usage.cache_read_input_tokens,
  });

  return (parsed.results ?? []).map((r) => {
    const idx = Number(String(r.review_ref).replace(/^r/, ''));
    const source = batch[idx];
    if (!source) {
      log.warn('classifier returned an unknown review ref', { ref: r.review_ref });
      return null;
    }
    return { review_id: source.id, model: MODEL, findings: r.findings ?? [] };
  }).filter(Boolean);
}

/**
 * Reduce findings to the management-attributable subset worth scoring.
 * Low-confidence and trivial findings are dropped here, once, rather than
 * being filtered inconsistently at each call site.
 */
export function managementFindings(findings, { minConfidence = 0.6, minSeverity = 2 } = {}) {
  return findings.filter(
    (f) => f.attribution === 'management' &&
           f.confidence >= minConfidence &&
           f.severity >= minSeverity,
  );
}
