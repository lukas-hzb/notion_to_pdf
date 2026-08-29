import type { Issue } from './model';

export interface PdfResult {
  data: Uint8Array;
  pageCount: number;
  issues: Issue[];
  durationMs: number;
}
export interface Progress { phase: string; completed: number; total: number }
export interface SkippedPage { id: string; title: string; sourcePath: string; reason: 'properties-only' }
export interface ExportResult { directory: string; files: string[]; issues: Issue[]; skipped: SkippedPage[] }
