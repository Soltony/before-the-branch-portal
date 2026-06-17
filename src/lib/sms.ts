/* Server-side SMS helper
 * Uses `SMS_URL` env var (default from your example: http://172.24.9.141/alert.php)
 * Sends form-encoded POST with `to` and `text` fields.
 * Includes retry with exponential backoff for transient failures.
 */

const SMS_MAX_RETRIES = 2; // up to 2 retries (3 total attempts)
const SMS_INITIAL_RETRY_DELAY_MS = 1000; // 1 second initial backoff
const SMS_REQUEST_TIMEOUT_MS = 15000; // 15 second timeout per request

async function sendSmsOnce(
  smsUrl: string,
  formattedPhone: string,
  text: string,
) {
  const params = new URLSearchParams();
  params.append("to", formattedPhone);
  params.append("text", text);

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SMS_REQUEST_TIMEOUT_MS,
  );

  try {
    const res = await fetch(smsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });

    const body = await res.text().catch(() => null);

    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        body,
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    return { ok: true as const, status: res.status, body, retryable: false };
  } catch (err: any) {
    const isTimeout = err?.name === "AbortError";
    return {
      ok: false as const,
      error: isTimeout ? "Request timeout" : String(err?.message ?? err),
      retryable: true,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendSms(to: string, text: string) {
  const smsUrl = process.env.SMS_URL;
  if (!smsUrl) {
    console.error("[sms] SMS_URL env var not set");
    return { ok: false, error: "SMS_URL env var not set" };
  }

  // Format phone: get last 9 digits and prepend with 0 (e.g., 0912345678)
  const formattedPhone = "0" + to.replace(/\D/g, "").slice(-9);

  let lastResult: any = null;

  for (let attempt = 0; attempt <= SMS_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = SMS_INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      console.info("[sms] retrying", { to, attempt, delay });
    }

    lastResult = await sendSmsOnce(smsUrl, formattedPhone, text);

    if (lastResult.ok) {
      console.info("[sms] sent", {
        to,
        smsUrl,
        status: lastResult.status,
        attempt,
      });
      return { ok: true, status: lastResult.status, body: lastResult.body };
    }

    if (!lastResult.retryable) {
      break; // Don't retry non-retryable errors (4xx etc.)
    }
  }

  console.error("[sms] send failed after retries", {
    to,
    smsUrl,
    status: lastResult?.status,
    error: lastResult?.error,
    body: lastResult?.body,
  });

  return {
    ok: false,
    status: lastResult?.status,
    body: lastResult?.body,
    error: lastResult?.error || `HTTP ${lastResult?.status}`,
  };
}

export default sendSms;
