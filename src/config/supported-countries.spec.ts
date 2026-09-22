import {
  SUPPORTED_COUNTRIES,
  getSupportedCountry,
  currencyForCountry,
} from './supported-countries';

describe('getSupportedCountry', () => {
  it('returns the config for a known country code', () => {
    expect(getSupportedCountry('KE')).toEqual(SUPPORTED_COUNTRIES.KE);
    expect(getSupportedCountry('UG')).toEqual(SUPPORTED_COUNTRIES.UG);
  });

  it('throws for an unmapped country code', () => {
    expect(() => getSupportedCountry('ZZ')).toThrow(/Unsupported country code/);
  });
});

describe('currencyForCountry', () => {
  it('resolves the ISO 4217 currency for a supported country', () => {
    expect(currencyForCountry('KE')).toBe('KES');
    expect(currencyForCountry('UG')).toBe('UGX');
  });
});
