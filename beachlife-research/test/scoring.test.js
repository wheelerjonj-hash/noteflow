import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prospectScore, companyScorecard } from '../src/analyze/scorecard.js';
import { managementFindings } from '../src/analyze/review-classifier.js';

const steady = {
  reviews12mo: 20, mgmtIssues12mo: 4, reviewsPrior: 20, mgmtIssuesPrior: 4,
  unanswered12mo: 2, avgSeverity: 3, ratingNow: 4.4, ratingPrior: 4.4, absenteeOwner: false,
};

test('a deteriorating property outranks a steadily mediocre one', () => {
  const deteriorating = {
    ...steady, mgmtIssues12mo: 9, mgmtIssuesPrior: 2, ratingNow: 4.1, ratingPrior: 4.7,
  };
  assert.ok(prospectScore(deteriorating).score > prospectScore(steady).score);
});

test('deterioration outweighs a higher static complaint level', () => {
  // Chronically bad but not getting worse — the owner has likely made peace.
  const chronic = { ...steady, mgmtIssues12mo: 10, mgmtIssuesPrior: 10 };
  // Less bad overall, but sharply worse than last year.
  const worsening = { ...steady, mgmtIssues12mo: 7, mgmtIssuesPrior: 1 };
  assert.ok(prospectScore(worsening).score > prospectScore(chronic).score);
});

test('thin review histories are discounted, not amplified', () => {
  const thin = { ...steady, reviews12mo: 2, mgmtIssues12mo: 2, reviewsPrior: 2, mgmtIssuesPrior: 0 };
  const thick = { ...steady, reviews12mo: 40, mgmtIssues12mo: 20, reviewsPrior: 40, mgmtIssuesPrior: 4 };
  assert.ok(prospectScore(thin).score < prospectScore(thick).score);
});

test('an absentee owner adds signal but cannot carry a score alone', () => {
  const clean = {
    reviews12mo: 20, mgmtIssues12mo: 0, reviewsPrior: 20, mgmtIssuesPrior: 0,
    unanswered12mo: 0, avgSeverity: 0, ratingNow: 4.9, ratingPrior: 4.9, absenteeOwner: true,
  };
  const s = prospectScore(clean);
  assert.ok(s.score < 0.2, `well-managed absentee property scored ${s.score}`);
  assert.ok(s.components.absenteeOwner > 0);
});

test('score components are exposed for explainability', () => {
  const s = prospectScore(steady);
  assert.deepEqual(
    Object.keys(s.components).sort(),
    ['absenteeOwner', 'issueRate12mo', 'issueRateDelta', 'ratingTrend', 'severity', 'unansweredRate'],
  );
  // The evidence discount only ever reduces: with a full review history the
  // score equals the component sum (modulo rounding); with a thin one it is
  // strictly lower.
  const total = Object.values(s.components).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - s.score) < 1e-4, `${total} vs ${s.score}`);

  const thin = prospectScore({ ...steady, reviews12mo: 3 });
  const thinTotal = Object.values(thin.components).reduce((a, b) => a + b, 0);
  assert.ok(thin.score < thinTotal);
});

test('managementFindings drops non-management and low-confidence findings', () => {
  const findings = [
    { category: 'maintenance_delay', attribution: 'management', severity: 4, confidence: 0.9 },
    { category: 'noise_rules', attribution: 'location', severity: 4, confidence: 0.9 },
    { category: 'cleanliness', attribution: 'management', severity: 3, confidence: 0.3 },
    { category: 'listing_accuracy', attribution: 'management', severity: 1, confidence: 0.9 },
  ];
  const kept = managementFindings(findings);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].category, 'maintenance_delay');
});

test('company scorecard counts parcels, not listings', () => {
  // The same house on Airbnb and VRBO is one property, not two.
  const rows = [
    { is_active: true, parcel_id: 'P1', rating: 4.5, reviews_12mo: 10, mgmt_issues_12mo: 2,
      reviews_prior: 10, mgmt_issues_prior: 1, responded_12mo: 8, category_counts: { cleanliness: 2 } },
    { is_active: true, parcel_id: 'P1', rating: 4.5, reviews_12mo: 5, mgmt_issues_12mo: 1,
      reviews_prior: 5, mgmt_issues_prior: 0, responded_12mo: 3, category_counts: { cleanliness: 1 } },
    { is_active: true, parcel_id: 'P2', rating: 4.0, reviews_12mo: 5, mgmt_issues_12mo: 3,
      reviews_prior: 5, mgmt_issues_prior: 1, responded_12mo: 1, category_counts: { responsiveness: 3 } },
  ];
  const sc = companyScorecard(rows, 50);
  assert.equal(sc.listings_active, 3);
  assert.equal(sc.parcels_confirmed, 2);
  assert.equal(sc.market_share_pct, 4);
  assert.equal(sc.top_issue_categories[0].category, 'cleanliness');
  assert.ok(sc.issue_rate_delta > 0);
});
