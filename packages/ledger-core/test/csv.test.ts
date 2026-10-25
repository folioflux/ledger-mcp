import { describe, expect, it } from 'vitest';
import { detectDelimiter, LedgerError, parseCsv } from '../src/index.js';

const cells = (text: string, delimiter: ',' | ';' = ',') =>
  parseCsv(text, delimiter).map((record) => record.cells);

describe('parseCsv', () => {
  it('splits simple records', () => {
    expect(cells('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles CRLF, LF and CR line endings and a missing final newline', () => {
    expect(cells('a,b\r\n1,2\r3,4\n5,6')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('keeps delimiters, doubled quotes and line breaks inside quoted fields', () => {
    const records = parseCsv('a,b\n"x, y","say ""hi""\nthere"\nlast,row\n', ',');
    expect(records.map((record) => record.cells)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
      ['last', 'row'],
    ]);
    expect(records.map((record) => record.line)).toEqual([1, 2, 4]);
  });

  it('keeps empty fields, including a trailing one', () => {
    expect(cells('a,,c,\n')).toEqual([['a', '', 'c', '']]);
    expect(cells('"",x')).toEqual([['', 'x']]);
  });

  it('reports an unterminated quote with its line', () => {
    expect(() => parseCsv('a,b\n1,"open\n', ',')).toThrow(/line 2/);
    expect(() => parseCsv('a,b\n1,"open\n', ',')).toThrow(LedgerError);
  });

  it('rejects text after a closing quote', () => {
    expect(() => parseCsv('a,b\n"x"y,2\n', ',')).toThrow(/after a closing quote on line 2/);
  });

  it('uses the requested delimiter', () => {
    expect(cells('a;b,c\n1;2,3\n', ';')).toEqual([
      ['a', 'b,c'],
      ['1', '2,3'],
    ]);
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['a,b,c\n1,2,3\n', ','],
    ['a;b;c\n1;2,50;3\n', ';'],
    ['a\tb\n1\t2\n', '\t'],
    ['a|b\n1|2\n', '|'],
  ])('detects the delimiter of %j', (text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it('prefers the delimiter that keeps rows consistent', () => {
    expect(detectDelimiter('Date;Text;Amount\n01.01.2026;a, b;1,50\n02.01.2026;c;2,00\n')).toBe(
      ';',
    );
  });

  it('returns null for a single column', () => {
    expect(detectDelimiter('only\none\n')).toBeNull();
  });
});
