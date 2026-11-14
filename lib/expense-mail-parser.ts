export type GmailMessage = {
  id: string;
  internalDate: string;
  payload?: {
    headers?: { name: string; value: string }[];
    body?: { data?: string };
    mimeType?: string;
    parts?: any[];
  };
};
export function receiptCandidate(message: GmailMessage) {
  const headers = message.payload?.headers || [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value || "";
  const parts = (p: any): string => {
    if (!p) return "";
    const own =
      p.body?.data &&
      (p.mimeType === "text/plain" || p.mimeType === "text/html")
        ? Buffer.from(p.body.data, "base64url").toString("utf8")
        : "";
    return own + "\n" + (p.parts || []).map(parts).join("\n");
  };
  const text = parts(message.payload)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .slice(0, 18000);
  const subject = header("subject").slice(0, 500),
    sender = header("from").slice(0, 500);
  const amounts = [
    ...text.matchAll(
      /(?:amount paid|total paid|payment amount|you paid)\s*[:\-]?\s*(?:USD\s*\$?|\$)\s*([\d,]+\.\d{2})/gi,
    ),
  ].map((m) => Number(m[1].replaceAll(",", "")));
  const unique = [...new Set(amounts)];
  const blocked =
    /payment (?:failed|declined)|amount due|payment due|refund|credit note|trial|will be charged/i.test(
      subject + " " + text,
    );
  const canceled =
    /subscription (?:has been |was |is )?cancel(?:l)?ed|cancellation confirm/i.test(
      subject + " " + text,
    );
  return {
    subject,
    sender,
    received_on: new Date(Number(message.internalDate))
      .toISOString()
      .slice(0, 10),
    excerpt: text.slice(0, 10000),
    rfc_id: header("message-id").trim(),
    suggestion: {
      kind: canceled ? "subscription" : "payment",
      status: canceled ? "Canceled" : "Needs verification",
      amount:
        !blocked && unique.length === 1 && unique[0] > 0 ? unique[0] : null,
      currency: "USD",
      warning: blocked
        ? "Invoice, trial, failed payment or refund language found. Do not record it as a payment unless settlement is confirmed."
        : "Confirm the paid date, currency and amount. Email receipt dates are not necessarily payment dates.",
    },
  };
}
