import Papa from "papaparse";
import type { SchemaFieldDefinition } from "../services/schema";
import { downloadJsonFile } from "../services/scriptTransfer";
import type { BatchSession } from "./types";

export function downloadTextFile(fileName: string, payload: string, contentType: string): void {
  const blob = new Blob([payload], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function formatBatchExportFileName(scriptId: string, suffix: string, now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `actiondock-batch-${scriptId}-${suffix}-${stamp}`;
}

export function exportBatchSessionAsJson(session: BatchSession, suffix = "results"): void {
  downloadJsonFile(`${formatBatchExportFileName(session.scriptId, suffix)}.json`, session);
}

export function exportBatchSessionAsCsv(args: {
  session: BatchSession;
  inputFields?: SchemaFieldDefinition[];
  outputFields?: SchemaFieldDefinition[];
  onlyFailures?: boolean;
  suffix?: string;
}): void {
  const rows = buildBatchResultCsvRows(args.session, args.inputFields ?? [], args.outputFields ?? [], args.onlyFailures);
  const csv = Papa.unparse(rows);
  downloadTextFile(
    `${formatBatchExportFileName(args.session.scriptId, args.suffix ?? (args.onlyFailures ? "failures" : "results"))}.csv`,
    csv,
    "text/csv;charset=utf-8"
  );
}

export function buildCsvTemplate(fields: SchemaFieldDefinition[]): string {
  return Papa.unparse({
    fields: fields.map((field) => field.name),
    data: []
  });
}

export function buildBatchResultCsvRows(
  session: BatchSession,
  inputFields: SchemaFieldDefinition[],
  outputFields: SchemaFieldDefinition[],
  onlyFailures = false
): Array<Record<string, unknown>> {
  const filteredItems = onlyFailures
    ? session.items.filter((item) => item.status !== "SUCCESS")
    : session.items;

  return filteredItems.map((item) => {
    const row: Record<string, unknown> = {
      rowIndex: item.rowIndex,
      status: item.status,
      executionId: item.executionId ?? "",
      errorMessage: item.errorMessage ?? item.errors.join("；"),
      inputJson: JSON.stringify(item.input),
      outputJson: JSON.stringify(item.execution?.output ?? {}),
      createdAt: item.execution?.createdAt ?? "",
      startedAt: item.startedAt ?? item.execution?.startedAt ?? "",
      finishedAt: item.finishedAt ?? item.execution?.finishedAt ?? ""
    };

    for (const field of inputFields) {
      row[`input.${field.name}`] = item.input[field.name];
    }
    for (const field of outputFields) {
      row[`output.${field.name}`] = item.execution?.output?.[field.name];
    }

    return row;
  });
}
