// Prospect and company scoring.
//
// The ranking question is not "which property has bad reviews" — it is "which
// OWNER is most likely to be receptive to a conversation about changing
// managers". Those differ. A property with a steady 4.2 and a stable complaint
// rate has an owner who has probably made peace with it. A property that fell
// from 4.8 to 4.1 in the last year is one where the owner has noticed too.
//
// Hence DELTA is weighted above LEVEL throughout.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const WEIGHTS = {
  issueRateDelta: 0.32,   // deterioration — the strongest receptiveness signal
  issueRate12mo: 0.22,    // current pain level
  unansweredRate: 0.14,   // manager not even responding publicly
  ratingTrend: 0.14,      // trajectory the owner can see on their own dashboard
  severity: 0.10,         // are the complaints serious or cosmetic
  absenteeOwner: 0.08,    // out-of-area owners rely on the manager most
};

/**
 * @param {object} m
 * @param {number} m.reviews12mo         review count, trailing 12 months
 * @param {number} m.mgmtIssues12mo      management-attributed findings, trailing 12 months
 * @param {number} m.reviewsPrior        review count, the 12 months before that
 * @param {number} m.mgmtIssuesPrior     management-attributed findings, prior period
 * @param {number} m.unanswered12mo      reviews with no host response, trailing 12 months
 * @param {number} m.avgSeverity         mean severity of management findings (1-5)
 * @param {number} m.ratingNow           mean rating, trailing 12 months
 * @param {number} m.ratingPrior         mean rating, prior 12 months
 * @param {boolean} m.absenteeOwner      owner mailing address outside the county
 */
export function prospectScore(m) {
  // Thin review histories produce noisy rates. Shrink toward the base rate
  // instead of letting one bad review off two reviews top the list.
  const PRIOR_STRENGTH = 6;
  const BASE_RATE = 0.12;

  const rate = (issues, n) =>
    (issues + BASE_RATE * PRIOR_STRENGTH) / (Math.max(n, 0) + PRIOR_STRENGTH);

  const issueRate12mo = rate(m.mgmtIssues12mo ?? 0, m.reviews12mo ?? 0);
  const issueRatePrior = rate(m.mgmtIssuesPrior ?? 0, m.reviewsPrior ?? 0);
  const delta = issueRate12mo - issueRatePrior;

  const unansweredRate = (m.reviews12mo ?? 0) > 0
    ? (m.unanswered12mo ?? 0) / m.reviews12mo
    : 0;

  const ratingDrop = (m.ratingPrior ?? 0) && (m.ratingNow ?? 0)
    ? m.ratingPrior - m.ratingNow
    : 0;

  const components = {
    // A delta of +0.20 (e.g. 10% → 30% of reviews flagging management) is a
    // strong signal; scale so that saturates the term.
    issueRateDelta: clamp01(delta / 0.20) * WEIGHTS.issueRateDelta,
    issueRate12mo: clamp01(issueRate12mo / 0.45) * WEIGHTS.issueRate12mo,
    unansweredRate: clamp01(unansweredRate) * WEIGHTS.unansweredRate,
    // A half-star drop in a year is significant on a 5-point scale.
    ratingTrend: clamp01(ratingDrop / 0.5) * WEIGHTS.ratingTrend,
    severity: clamp01(((m.avgSeverity ?? 0) - 2) / 3) * WEIGHTS.severity,
    absenteeOwner: (m.absenteeOwner ? 1 : 0) * WEIGHTS.absenteeOwner,
  };

  const raw = Object.values(components).reduce((a, b) => a + b, 0);

  // Confidence discount for thin evidence: a score built on three reviews is
  // not the same as one built on forty, and the ranking should say so.
  const evidence = clamp01((m.reviews12mo ?? 0) / 10);
  const score = raw * (0.45 + 0.55 * evidence);

  return {
    score: Number(score.toFixed(4)),
    components,
    mgmt_issue_rate_12mo: Number(issueRate12mo.toFixed(4)),
    mgmt_issue_rate_prior: Number(issueRatePrior.toFixed(4)),
    issue_rate_delta: Number(delta.toFixed(4)),
    unanswered_rate: Number(unansweredRate.toFixed(4)),
    rating_trend: Number((-ratingDrop).toFixed(3)),
    reviews_12mo: m.reviews12mo ?? 0,
  };
}

/**
 * Company-level rollup for competitive intelligence.
 * Market share is computed over CONFIRMED parcels only — counting unmatched
 * listings would double-count the same house listed on Airbnb and VRBO.
 */
export function companyScorecard(rows, totalConfirmedParcels) {
  const listingsActive = rows.filter((r) => r.is_active).length;
  const parcels = new Set(rows.map((r) => r.parcel_id).filter(Boolean));
  const rated = rows.filter((r) => r.rating != null);
  const reviews12 = rows.reduce((a, r) => a + (r.reviews_12mo ?? 0), 0);
  const issues12 = rows.reduce((a, r) => a + (r.mgmt_issues_12mo ?? 0), 0);
  const reviewsPrior = rows.reduce((a, r) => a + (r.reviews_prior ?? 0), 0);
  const issuesPrior = rows.reduce((a, r) => a + (r.mgmt_issues_prior ?? 0), 0);
  const responded = rows.reduce((a, r) => a + (r.responded_12mo ?? 0), 0);

  const rate12 = reviews12 ? issues12 / reviews12 : null;
  const ratePrior = reviewsPrior ? issuesPrior / reviewsPrior : null;

  const catCounts = {};
  for (const r of rows) {
    for (const [cat, n] of Object.entries(r.category_counts ?? {})) {
      catCounts[cat] = (catCounts[cat] ?? 0) + n;
    }
  }
  const topIssueCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  return {
    listings_active: listingsActive,
    parcels_confirmed: parcels.size,
    market_share_pct: totalConfirmedParcels
      ? Number(((parcels.size / totalConfirmedParcels) * 100).toFixed(2))
      : null,
    avg_rating: rated.length
      ? Number((rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length).toFixed(2))
      : null,
    mgmt_issue_rate_12mo: rate12 == null ? null : Number(rate12.toFixed(4)),
    mgmt_issue_rate_prior: ratePrior == null ? null : Number(ratePrior.toFixed(4)),
    issue_rate_delta:
      rate12 != null && ratePrior != null ? Number((rate12 - ratePrior).toFixed(4)) : null,
    response_rate: reviews12 ? Number((responded / reviews12).toFixed(4)) : null,
    top_issue_categories: topIssueCategories,
  };
}
