
export type Segment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
};

export async function readOpenAIError(response: Response) {
  try {
    const body = await response.json();
    return body?.error?.message || JSON.stringify(body);
  } catch {
    return await response.text();
  }
}

export function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const pieces: string[] = [];
  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const content of item.content) {
        if (
          (content?.type === "output_text" || content?.type === "text") &&
          typeof content?.text === "string" &&
          content.text.trim()
        ) {
          pieces.push(content.text.trim());
        }
      }
    }
  }
  return pieces.join("\n").trim();
}

export async function structuredResponse(
  apiKey: string,
  model: string,
  input: string,
  schemaName: string,
  schema: Record<string, unknown>
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI 分析失敗：${await readOpenAIError(response)}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) throw new Error("OpenAI 請求成功，但沒有可解析輸出。");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`OpenAI JSON 解析失敗：${text.slice(0, 220)}`);
  }
}

export async function transcribeWithSegments(
  apiKey: string,
  blob: Blob,
  filename: string
): Promise<{ text: string; duration: number; segments: Segment[] }> {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe-diarize");
  form.append("response_format", "diarized_json");
  form.append("chunking_strategy", "auto");
  form.append("language", "en");
  form.append("file", blob, filename);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`OpenAI 轉錄失敗：${await readOpenAIError(response)}`);
  }

  const payload = await response.json();
  const segments: Segment[] = Array.isArray(payload?.segments)
    ? payload.segments
        .map((seg: any) => ({
          start: Number(seg?.start ?? 0),
          end: Number(seg?.end ?? 0),
          text: String(seg?.text ?? "").trim(),
          speaker: typeof seg?.speaker === "string" ? seg.speaker : undefined,
        }))
        .filter(
          (seg: Segment) =>
            Number.isFinite(seg.start) &&
            Number.isFinite(seg.end) &&
            seg.end >= seg.start &&
            seg.text
        )
    : [];

  return {
    text: String(payload?.text ?? "").trim(),
    duration: Number(payload?.duration ?? 0),
    segments,
  };
}

export function windowText(
  segments: Segment[],
  start: number,
  end: number
) {
  const selected = segments.filter((seg) => {
    const midpoint = (seg.start + seg.end) / 2;
    return midpoint >= start && midpoint <= end;
  });

  const speechSeconds = selected.reduce(
    (sum, seg) =>
      sum + Math.max(0, Math.min(end, seg.end) - Math.max(start, seg.start)),
    0
  );

  const windowSeconds = Math.max(0.01, end - start);

  return {
    text: selected.map((x) => x.text).join(" ").trim(),
    speech_seconds: Math.round(speechSeconds * 10) / 10,
    window_seconds: Math.round(windowSeconds * 10) / 10,
    speech_ratio: Math.round((speechSeconds / windowSeconds) * 1000) / 10,
  };
}
