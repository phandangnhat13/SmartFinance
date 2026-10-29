import {
  buildFeedbackRecord,
  normalizeFeedbackKey,
  redactDescription,
} from './feedback-export.util';

describe('feedback export utilities', () => {
  it('redacts emails, Vietnamese phone numbers and long digit strings', () => {
    expect(redactDescription('chuyen tien cho an@example.com so 0912345678 tk 123456789012')).toBe(
      'chuyen tien cho [email] so [phone] tk [number]',
    );
  });

  it('keeps ordinary amounts and normalizes whitespace/control characters', () => {
    expect(redactDescription('  mua\u0000 đồ ăn   65000  ')).toBe('mua đồ ăn 65000');
  });

  it('builds a record only for taxonomy labels and meaningful text', () => {
    const record = buildFeedbackRecord({
      predictionId: 'p1',
      inputDescription: 'cà phê sáng',
      predictedSlug: 'food',
      acceptedSlug: 'food',
      modelVersion: 'v2',
      status: 'ACCEPTED',
    });
    expect(record).toMatchObject({ text: 'cà phê sáng', label: 'food', status: 'ACCEPTED' });

    expect(
      buildFeedbackRecord({
        predictionId: 'p2',
        inputDescription: 'mua đồ',
        predictedSlug: 'food',
        acceptedSlug: 'custom-category',
        modelVersion: 'v2',
        status: 'CORRECTED',
      }),
    ).toBeNull();

    expect(
      buildFeedbackRecord({
        predictionId: 'p3',
        inputDescription: '   ',
        predictedSlug: null,
        acceptedSlug: 'food',
        modelVersion: 'v2',
        status: 'ACCEPTED',
      }),
    ).toBeNull();
  });

  it('deduplicates case and spacing variants', () => {
    expect(normalizeFeedbackKey('Cà phê  Sáng', 'food')).toBe(
      normalizeFeedbackKey('cà phê sáng', 'food'),
    );
  });
});
