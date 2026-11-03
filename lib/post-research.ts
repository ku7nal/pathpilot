export async function postResearch<T>(path: string, body: object, onProgress: (message: string) => void): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Live research could not start.");
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error("The research service returned an unexpected response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: T | null = null;
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    let boundary;
    while ((boundary = pending.search(/\r?\n\r?\n/)) !== -1) {
      const delimiter = pending.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
      const block = pending.slice(0, boundary);
      const name = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataText = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      pending = pending.slice(boundary + delimiter.length);
      if (!name || !dataText) continue;
      let data: Record<string, unknown>;
      try { data = JSON.parse(dataText); } catch { continue; }
      if (["status", "progress"].includes(name) && typeof data.message === "string") onProgress(data.message);
      if (name === "complete") result = data as T;
      if (name === "error") throw new Error(typeof data.message === "string" ? data.message : "Live research failed.");
    }
    if (done) break;
  }
  if (result === null) throw new Error("The research stream ended before results were returned.");
  return result;
}
