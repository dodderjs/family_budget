export function toCsvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return [headers.join(','), ...rows.map((row) => row.map(toCsvCell).join(','))].join('\n');
}

export function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): void {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
