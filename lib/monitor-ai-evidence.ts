/** Accept only completed Claude results with a successful WebSearch tool response. */
export function parseClaudeEvidence(events: any[]) {
  const blocks = events.flatMap((e) =>
    Array.isArray(e.message?.content) ? e.message.content : [],
  );
  const searches = new Set(
    blocks
      .filter((b) => b.type === "tool_use" && b.name === "WebSearch")
      .map((b) => b.id),
  );
  const grounded = blocks.some(
    (b) =>
      b.type === "tool_result" &&
      searches.has(b.tool_use_id) &&
      !b.is_error &&
      /https?:\/\//.test(JSON.stringify(b.content)),
  );
  const result = events.filter((e) => e.type === "result").at(-1);
  const data = result?.structured_output;
  if (
    !grounded ||
    result?.is_error ||
    result?.subtype !== "success" ||
    typeof data?.answer !== "string" ||
    data.answer.length < 10 ||
    data.answer.length > 30000 ||
    !Array.isArray(data.citations)
  )
    throw Error("Claude grounded answer unavailable");
  const citations = [
    ...new Set<string>(
      data.citations.filter((u: any) => {
        try {
          return (
            typeof u === "string" &&
            ["https:", "http:"].includes(new URL(u).protocol)
          );
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, 30);
  return { answer: data.answer, citations };
}
