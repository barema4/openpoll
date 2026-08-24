import type { InvoiceSource } from '../../../generated/prisma/enums';

export interface ContributorEntry {
  invoiceId: string;
  contributorName: string | null;
  contributorPhone?: string | null;
  amountRequested: number;
  amountPaid: number;
  remaining: number;
  source: InvoiceSource;
}

export interface ContributorBuckets {
  pledged: ContributorEntry[];
  partiallyPaid: ContributorEntry[];
  fullyPaid: ContributorEntry[];
  expired: ContributorEntry[];
}

export interface ContributorTotals {
  pledged: number;
  received: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatSection(
  title: string,
  emoji: string,
  entries: ContributorEntry[],
): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) => {
    const name = e.contributorName ?? 'Anonymous';
    if (e.remaining > 0 && e.amountPaid > 0) {
      return `- ${name} — ${formatMoney(e.amountPaid)} of ${formatMoney(e.amountRequested)} (${formatMoney(e.remaining)} remaining)`;
    }
    if (e.amountPaid > 0) {
      return `- ${name} — ${formatMoney(e.amountPaid)}`;
    }
    return `- ${name} — ${formatMoney(e.amountRequested)} pledged`;
  });
  return `${emoji} ${title} (${entries.length})\n${lines.join('\n')}`;
}

export function formatContributorSummaryText(
  eventTitle: string,
  buckets: ContributorBuckets,
  totals: ContributorTotals,
): string {
  const sections = [
    formatSection('Fully Paid', '✅', buckets.fullyPaid),
    formatSection('Partially Paid', '🔶', buckets.partiallyPaid),
    formatSection('Pledged, Not Yet Paid', '🕓', buckets.pledged),
  ].filter(Boolean);

  const header = `🎉 ${eventTitle} — Contribution Update`;
  const body =
    sections.length > 0 ? sections.join('\n\n') : 'No contributions yet.';
  const footer = `Total pledged: ${formatMoney(totals.pledged)} | Received: ${formatMoney(totals.received)}`;

  return `${header}\n\n${body}\n\n${footer}`;
}
