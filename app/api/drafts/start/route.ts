import { groupRecentMessages } from "../../../../lib/gfnf-context";

type ExportMessage = {
  message: string;
  name: string;
  timestamp: string;
};

type DiagnosticCheck = {
  label: string;
  status: "pass" | "fail";
  detail: string;
};

const MESSAGE_LIMIT = 50;

function isExportMessage(value: unknown): value is ExportMessage {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.message === "string" &&
    typeof record.name === "string" &&
    typeof record.timestamp === "string" &&
    Number.isFinite(Date.parse(record.timestamp))
  );
}

function jsonFailure(
  status: number,
  startedAt: number,
  summary: string,
  checks: DiagnosticCheck[],
) {
  return Response.json(
    {
      success: false,
      summary,
      durationMs: Date.now() - startedAt,
      checks,
    },
    { status },
  );
}

export async function POST() {
  const startedAt = Date.now();
  const token = process.env.ALETHEIA_API_TOKEN?.trim();
  const exportUrl = process.env.ALETHEIA_EXPORT_URL?.trim();
  const checks: DiagnosticCheck[] = [];

  if (!token || !exportUrl) {
    checks.push({
      label: "Configuration",
      status: "fail",
      detail: "The server is missing its Aletheia endpoint or API token.",
    });
    return jsonFailure(500, startedAt, "Aletheia is not configured.", checks);
  }

  checks.push({
    label: "Configuration",
    status: "pass",
    detail: "Server-only credentials are available.",
  });

  try {
    const response = await fetch(exportUrl, {
      headers: {
        Accept: "application/x-ndjson, application/jsonl, text/plain",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      checks.push({
        label: "API request",
        status: "fail",
        detail: `Aletheia responded with HTTP ${response.status}.`,
      });
      return jsonFailure(502, startedAt, "The message export request failed.", checks);
    }

    checks.push({
      label: "API request",
      status: "pass",
      detail: `Aletheia responded with HTTP ${response.status}.`,
    });

    const body = await response.text();
    const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const messages: ExportMessage[] = [];
    let rejectedRecords = 0;

    for (const line of lines) {
      try {
        const record: unknown = JSON.parse(line);
        if (isExportMessage(record)) {
          messages.push(record);
        } else {
          rejectedRecords += 1;
        }
      } catch {
        rejectedRecords += 1;
      }
    }

    if (messages.length === 0) {
      checks.push({
        label: "Message parsing",
        status: "fail",
        detail: `No valid messages were found in ${lines.length} records.`,
      });
      return jsonFailure(502, startedAt, "The export contained no usable messages.", checks);
    }

    checks.push({
      label: "Message parsing",
      status: "pass",
      detail: `Parsed ${messages.length} records${
        rejectedRecords > 0 ? `; skipped ${rejectedRecords} invalid.` : "."
      }`,
    });

    const recentMessages = messages
      .sort(
        (left, right) =>
          Date.parse(left.timestamp) - Date.parse(right.timestamp),
      )
      .slice(-MESSAGE_LIMIT);
    const contextGroups = groupRecentMessages(messages, MESSAGE_LIMIT);

    checks.push({
      label: "Draft context",
      status: "pass",
      detail: `Loaded the newest ${recentMessages.length} messages.`,
    });

    return Response.json({
      success: true,
      summary: `${recentMessages.length} recent messages are ready for the new draft.`,
      durationMs: Date.now() - startedAt,
      messageCount: recentMessages.length,
      sourceRecordCount: messages.length,
      newestMessageAt: recentMessages.at(-1)?.timestamp ?? null,
      contextGroups,
      checks,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    checks.push({
      label: "API request",
      status: "fail",
      detail: timedOut
        ? "The request exceeded the 15-second limit."
        : "The server could not reach Aletheia.",
    });
    return jsonFailure(
      502,
      startedAt,
      timedOut ? "The message request timed out." : "The message request failed.",
      checks,
    );
  }
}
