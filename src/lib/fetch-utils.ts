export async function extractErrorMessage(response: Response, defaultMsg: string) {
  if (response.status === 401) return 'You must be signed in to perform this action. Please sign in and try again.';
  if (response.status === 403) return 'Not authorized to perform this action.';

  try {
    const data = await response.json();
    if (data && data.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    return JSON.stringify(data);
  } catch (e) {
    try {
      const text = await response.text();
      if (text) {
        const stripped = text.replace(/<[^>]*>/g, '');
        return stripped.length > 200 ? stripped.substring(0, 200) + '...' : stripped;
      }
    } catch (_e) {
      // ignore
    }
  }
  return defaultMsg;
}

export async function postPendingChange(body: any, defaultMsg = 'Failed to submit changes for approval.') {
  // Defensive client-side validation: if the payload contains embedded fileContent,
  // ensure the file is of an allowed type and not oversized before sending to the server.
  try {
    if (body && typeof body.payload === 'string') {
      const parsed = JSON.parse(body.payload);
      const parts = ['created', 'updated', 'original'];
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
      const allowedExt = /\.(xlsx|xls)$/i;
      for (const p of parts) {
        const item = parsed[p];
        if (item && typeof item === 'object') {
          const fileContent = item.fileContent;
          const fileName = item.fileName || item.file?.name;
          if (fileContent && fileName) {
            // estimate bytes from base64 length
            const b64len = fileContent.length;
            const approxBytes = Math.ceil((b64len * 3) / 4);
            if (approxBytes > MAX_FILE_SIZE) {
              throw new Error('File upload failed. Please try again.');
            }
            if (!allowedExt.test(fileName)) {
              throw new Error('File upload failed. Please try again.');
            }
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof Error) throw e; // rethrow validation message
    // ignore parsing errors and continue — server will validate
  }
  const resp = await fetch('/api/settings/pending-changes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const msg = await extractErrorMessage(resp, defaultMsg);
    throw new Error(msg);
  }

  return resp;
}
