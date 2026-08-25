export interface ShareChannel {
  available: boolean;
  url: string | null;
}

export interface InvoiceShareLinks {
  checkoutUrl: string;
  whatsapp: ShareChannel;
  email: ShareChannel;
}

function buildMessage(params: {
  contributorName: string | null;
  eventTitle: string;
  amountRequested: number | null;
  checkoutUrl: string;
}): string {
  const greeting = params.contributorName
    ? `Hi ${params.contributorName},`
    : 'Hi,';
  const amountLine = params.amountRequested
    ? `Amount: ${params.amountRequested.toLocaleString('en-US')}`
    : 'Contribute any amount.';
  return `${greeting} here's your payment link for "${params.eventTitle}":\n${params.checkoutUrl}\n${amountLine}`;
}

// wa.me requires digits only (no "+", spaces, or dashes).
function sanitizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function buildInvoiceShareLinks(params: {
  checkoutBaseUrl: string;
  secureToken: string;
  contributorName: string | null;
  contributorPhone: string | null;
  contributorEmail: string | null;
  eventTitle: string;
  amountRequested: number | null;
}): InvoiceShareLinks {
  const checkoutUrl = `${params.checkoutBaseUrl.replace(/\/$/, '')}/pay/${params.secureToken}`;
  const message = buildMessage({
    contributorName: params.contributorName,
    eventTitle: params.eventTitle,
    amountRequested: params.amountRequested,
    checkoutUrl,
  });

  const whatsapp: ShareChannel = params.contributorPhone
    ? {
        available: true,
        url: `https://wa.me/${sanitizePhoneForWhatsApp(params.contributorPhone)}?text=${encodeURIComponent(message)}`,
      }
    : { available: false, url: null };

  const email: ShareChannel = params.contributorEmail
    ? {
        available: true,
        url: `mailto:${encodeURIComponent(params.contributorEmail)}?subject=${encodeURIComponent(
          `Payment link for ${params.eventTitle}`,
        )}&body=${encodeURIComponent(message)}`,
      }
    : { available: false, url: null };

  return { checkoutUrl, whatsapp, email };
}
