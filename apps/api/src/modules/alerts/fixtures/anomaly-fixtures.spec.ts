import type { DetectorResult } from '../detectors/anomaly.types';
import { detectCategorySpike } from '../detectors/category-spike.detector';
import { detectLargeTransaction } from '../detectors/large-transaction.detector';
import { detectPossibleDuplicates } from '../detectors/possible-duplicate.detector';
import { FIXTURE_CASES, type FixtureCase } from './anomaly-scenarios';

function runFixture(fixture: FixtureCase): Array<DetectorResult<unknown>> {
  switch (fixture.kind) {
    case 'large': {
      if (!fixture.large)
        throw new Error(`Fixture ${fixture.id} is missing its large-transaction input`);
      const result = detectLargeTransaction(fixture.large);
      return result ? [result] : [];
    }
    case 'spike': {
      if (!fixture.spike)
        throw new Error(`Fixture ${fixture.id} is missing its category-spike input`);
      const result = detectCategorySpike(fixture.spike);
      return result ? [result] : [];
    }
    case 'duplicate': {
      if (!fixture.duplicate)
        throw new Error(`Fixture ${fixture.id} is missing its duplicate input`);
      return detectPossibleDuplicates(fixture.duplicate);
    }
  }
}

describe('anomaly fixture set — structure', () => {
  it('has unique ids and covers every detector with both outcomes', () => {
    const ids = FIXTURE_CASES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of ['large', 'spike', 'duplicate'] as const) {
      const cases = FIXTURE_CASES.filter((fixture) => fixture.kind === kind);
      expect(cases.some((fixture) => fixture.expected)).toBe(true);
      expect(cases.some((fixture) => !fixture.expected)).toBe(true);
    }
  });

  it('labels every positive case with the severity it expects', () => {
    for (const fixture of FIXTURE_CASES) {
      if (fixture.expected) expect(fixture.expectedSeverity).toBeDefined();
    }
  });
});

describe('anomaly fixture set — implementation matches the labelled expectations', () => {
  it.each(FIXTURE_CASES.map((fixture) => [fixture.id, fixture] as const))('%s', (_id, fixture) => {
    const results = runFixture(fixture);
    if (fixture.expected) {
      expect(results).toHaveLength(1);
      expect(results[0].severity).toBe(fixture.expectedSeverity);
      expect(results[0].explanation.trim().length).toBeGreaterThan(0);
      expect(results[0].dedupeKey.length).toBeGreaterThan(0);
    } else {
      expect(results).toHaveLength(0);
    }
  });
});

/**
 * Precision/recall computed over the hand-labelled synthetic fixtures above.
 *
 * This number answers exactly one question: "does the implementation reproduce
 * the labels we wrote for it?" It is NOT evidence of detection quality on real
 * users' data — the fixtures were authored by the same person who wrote the
 * rules, they are far too few to estimate a rate, and they exclude the real
 * world's messiness (missing imports, odd merchants, seasonality). Any claim
 * about real-world precision or recall would need a labelled sample of real
 * transactions, which this project does not have.
 */
describe('anomaly fixture set — synthetic precision/recall (not real-world evidence)', () => {
  it('reproduces every label and reports the confusion matrix', () => {
    const scored = FIXTURE_CASES.map((fixture) => ({
      fixture,
      predicted: runFixture(fixture).length > 0,
    }));

    const truePositives = scored.filter((row) => row.fixture.expected && row.predicted).length;
    const falsePositives = scored.filter((row) => !row.fixture.expected && row.predicted).length;
    const falseNegatives = scored.filter((row) => row.fixture.expected && !row.predicted).length;
    const trueNegatives = scored.filter((row) => !row.fixture.expected && !row.predicted).length;

    expect({
      total: scored.length,
      truePositives,
      falsePositives,
      falseNegatives,
      trueNegatives,
    }).toEqual({
      total: 21,
      truePositives: 6,
      falsePositives: 0,
      falseNegatives: 0,
      trueNegatives: 15,
    });

    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / (truePositives + falseNegatives);
    const falsePositiveRate = falsePositives / (falsePositives + trueNegatives);

    expect(precision).toBe(1);
    expect(recall).toBe(1);
    expect(falsePositiveRate).toBe(0);
  });
});
