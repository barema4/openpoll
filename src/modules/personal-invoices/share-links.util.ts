export interface ShareChannel {
  available: boolean;
  url: string | null;
}

export interface PersonalInvoiceShareLinks {
  checkoutUrl: string;
  whatsapp: ShareChannel;
  email: ShareChannel;
}

function buildMessage(params: {
  recipientName: string;
  issuerName: string;
  description: string | null;
  amount: number;
  checkoutUrl: string;
}): string {
  const subject = params.description ? ` for "${params.description}"` : '';
  return `Hi ${params.recipientName}, ${params.issuerName} sent you an invoice${subject}:\n${params.checkoutUrl}\nAmount: ${params.amount.toLocaleString('en-US')}`;
}

// wa.me requires digits only (no "+", spaces, or dashes).
function sanitizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function buildPersonalInvoiceShareLinks(params: {
  checkoutBaseUrl: string;
  secureToken: string;
  recipientName: string;
  recipientPhone: string | null;
  recipientEmail: string | null;
  issuerName: string;
  description: string | null;
  amount: number;
}): PersonalInvoiceShareLinks {
  const checkoutUrl = `${params.checkoutBaseUrl.replace(/\/$/, '')}/i/${params.secureToken}`;
  const message = buildMessage({
    recipientName: params.recipientName,
    issuerName: params.issuerName,
    description: params.description,
    amount: params.amount,
    checkoutUrl,
  });

  const whatsapp: ShareChannel = params.recipientPhone
    ? {
        available: true,
        url: `https://wa.me/${sanitizePhoneForWhatsApp(params.recipientPhone)}?text=${encodeURIComponent(message)}`,
      }
    : { available: false, url: null };

  const email: ShareChannel = params.recipientEmail
    ? {
        available: true,
        url: `mailto:${encodeURIComponent(params.recipientEmail)}?subject=${encodeURIComponent(
          `Invoice from ${params.issuerName}`,
        )}&body=${encodeURIComponent(message)}`,
      }
    : { available: false, url: null };

  return { checkoutUrl, whatsapp, email };
}
