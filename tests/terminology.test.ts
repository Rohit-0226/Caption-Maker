import { describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  analyseTerminology,
  applyPreferredTerminology,
  cleanExtractedPdfText,
  extractPdfTerminology,
} from '../server/services/terminology';
import type { TranscriptWord } from '../src/core/types/project';

const words = (...values: string[]): TranscriptWord[] =>
  values.map((text, index) => ({
    text,
    start: index,
    end: index + 0.8,
    confidence: null,
  }));

const makeTextPdf = (text: string): Buffer => {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
};

describe('PDF terminology analysis', () => {
  it('finds branded casing, acronyms and client phrases', () => {
    const result = analyseTerminology(`
      AcmeFlow Client Operations Manual.
      Customer Success owns the SLA review for AcmeFlow accounts.
      The Customer Success team records every SLA exception in RevenueCloud.
    `);

    expect(result.terms).toContain('AcmeFlow');
    expect(result.terms).toContain('SLA');
    expect(result.terms).toContain('Customer Success');
    expect(result.terms).toContain('RevenueCloud');
    expect(result.transcriptionSample).toContain('AcmeFlow');
  });

  it('repairs words split across PDF line endings', () => {
    expect(cleanExtractedPdfText('termin-\nology')).toBe('terminology');
  });

  it('returns an empty result for an image-only document', () => {
    expect(analyseTerminology('   ')).toEqual({
      terms: [],
      rules: [],
      transcriptionSample: null,
      extractedCharacterCount: 0,
    });
  });

  it('reads preferred and avoid spellings from glossary-style rows', () => {
    const result = analyseTerminology(`
      Preferred   Avoid / Alternative   Notes
      zyada   jyada   Preferred in this guide
      Behaviour   Behavior   British English
      Analyse not Analyze
    `);

    expect(result.rules).toContainEqual({ preferred: 'zyada', alternatives: ['jyada'] });
    expect(result.rules).toContainEqual({ preferred: 'Behaviour', alternatives: ['Behavior'] });
    expect(result.rules).toContainEqual({ preferred: 'Analyse', alternatives: ['Analyze'] });
  });

  it('extracts selectable terminology from a real PDF file', async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-pdf-test-'));
    const file = path.join(directory, 'client-sop.pdf');
    try {
      await fsp.writeFile(file, makeTextPdf('AcmeFlow uses RevenueCloud and SLA reviews.'));
      const result = await extractPdfTerminology(file);
      expect(result.pageCount).toBe(1);
      expect(result.extractedCharacterCount).toBeGreaterThan(20);
      expect(result.terms).toContain('AcmeFlow');
      expect(result.terms).toContain('RevenueCloud');
      expect(result.terms).toContain('SLA');
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});

describe('preferred terminology correction', () => {
  it('uses canonical spelling and casing for a unique close match', () => {
    const corrected = applyPreferredTerminology(words('AcmFlow', 'handles', 's.l.a.'), [
      'AcmeFlow',
      'SLA',
    ]);
    expect(corrected.map((word) => word.text)).toEqual(['AcmeFlow', 'handles', 'SLA.']);
  });

  it('corrects a multi-word client phrase without changing timings', () => {
    const input = words('Costumer', 'Success,', 'responds');
    const corrected = applyPreferredTerminology(input, ['Customer Success']);
    expect(corrected.map((word) => word.text)).toEqual(['Customer', 'Success,', 'responds']);
    expect(corrected[0].start).toBe(input[0].start);
    expect(corrected[1].end).toBe(input[1].end);
  });

  it('does not guess when two terms are equally plausible', () => {
    const corrected = applyPreferredTerminology(words('capton'), ['caption', 'carton']);
    expect(corrected[0].text).toBe('capton');
  });

  it('leaves unrelated transcript words alone', () => {
    const corrected = applyPreferredTerminology(words('ordinary', 'sentence'), ['AcmeFlow']);
    expect(corrected.map((word) => word.text)).toEqual(['ordinary', 'sentence']);
  });

  it('honours an explicit alternative even when its first letter differs', () => {
    const corrected = applyPreferredTerminology(words('jyada', 'Behavior'), [], [
      { preferred: 'zyada', alternatives: ['jyada'] },
      { preferred: 'Behaviour', alternatives: ['Behavior'] },
    ]);
    expect(corrected.map((word) => word.text)).toEqual(['zyada', 'Behaviour']);
  });

  it('combines a multi-word alternative into the preferred hyphenated word', () => {
    const corrected = applyPreferredTerminology(words('aas', 'paas,'), [], [
      { preferred: 'aas-paas', alternatives: ['aas paas'] },
    ]);
    expect(corrected.map((word) => word.text)).toEqual(['aas-paas,']);
    expect(corrected[0].start).toBe(0);
    expect(corrected[0].end).toBe(1.8);
  });

  it('handles a short transposed spelling when the PDF gives an explicit alternative', () => {
    const corrected = applyPreferredTerminology(words('Jho'), [], [
      { preferred: 'jo', alternatives: ['joh'] },
    ]);
    expect(corrected[0].text).toBe('jo');
  });
});
