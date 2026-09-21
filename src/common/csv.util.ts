// Hand-rolled rather than pulling in a dependency — the report shapes in
// this app are small, fixed grids, not arbitrary user data needing a full
// CSV library's edge-case handling.
function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) => row.map((cell) => escapeCsvField(String(cell))).join(','))
    .join('\n');
}
