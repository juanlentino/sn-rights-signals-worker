// Bound the SQL API response independently of its row limit (labels vary in size).
const MAX_SQL_BYTES = 10 * 1024 * 1024;
export async function readSqlJson(response) {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_SQL_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("SQL response too large");
  }
  if (!response.body) throw new Error("Empty SQL response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SQL_BYTES) throw new Error("SQL response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
