export function squareCheckoutReady() {
  return (
    process.env.SQUARE_CHECKOUT_ENABLED === "true" &&
    !!(
      process.env.SQUARE_ACCESS_TOKEN &&
      process.env.SQUARE_LOCATION_ID &&
      process.env.SQUARE_WEBHOOK_SIGNATURE_KEY &&
      process.env.SQUARE_WEBHOOK_URL
    )
  );
}
export async function square(path: string, body?: unknown) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw Error("Square checkout is not connected yet.");
  const origin =
    process.env.SQUARE_ENVIRONMENT === "sandbox"
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com";
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": "2026-09-16",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const x = await r.json();
  if (!r.ok)
    throw Error("Square could not complete this request. Please try again.");
  return x;
}
