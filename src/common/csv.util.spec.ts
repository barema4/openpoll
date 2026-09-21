import { toCsv } from './csv.util';

describe('toCsv', () => {
  it('joins cells with commas and rows with newlines', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('a,b\nc,d');
  });

  it('quotes a field containing a comma', () => {
    expect(toCsv([['Acme, Inc.', 100]])).toBe('"Acme, Inc.",100');
  });

  it('quotes and escapes a field containing a double quote', () => {
    expect(toCsv([['Say "hi"', 1]])).toBe('"Say ""hi""",1');
  });

  it('quotes a field containing a newline', () => {
    expect(toCsv([['line1\nline2', 1]])).toBe('"line1\nline2",1');
  });

  it('leaves a plain field unquoted', () => {
    expect(toCsv([['plain', 42]])).toBe('plain,42');
  });

  it('renders an empty row as an empty string', () => {
    expect(toCsv([[], ['a']])).toBe('\na');
  });
});
