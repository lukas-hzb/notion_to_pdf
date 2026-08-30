import { z } from 'zod';

export const optionsSchema = z.object({
  preset: z.enum(['original', 'reading', 'print']).default('original'),
  paper: z.enum(['A4', 'Letter']).default('A4'),
  landscape: z.boolean().default(false),
  margin: z.number().min(8).max(35).default(16),
  fontSize: z.number().min(9).max(16).default(11),
  toggles: z.enum(['expanded', 'sections']).default('expanded'),
  tasks: z.enum(['checkboxes', 'bullets']).default('checkboxes'),
  preserveTaskStatus: z.boolean().optional(),
  columns: z.enum(['preserve', 'stack']).default('preserve'),
  tables: z.enum(['split', 'wrap']).default('split'),
  bookmarks: z.enum(['card', 'compact']).default('card'),
  databasePages: z.enum(['all', 'content']).default('all'),
  pageNumbers: z.boolean().default(true),
  continuousPage: z.boolean().default(false),
  includeCover: z.boolean().default(true),
  strict: z.boolean().default(false),
}).strict().transform(options => ({
  ...options,
  preserveTaskStatus: options.preserveTaskStatus ?? options.tasks === 'checkboxes',
  pageNumbers: options.continuousPage ? false : options.pageNumbers,
}));

export type ExportOptions = z.infer<typeof optionsSchema>;
export const defaultOptions: ExportOptions = optionsSchema.parse({});

export function presetOptions(preset: ExportOptions['preset'], current = defaultOptions): ExportOptions {
  const common = { ...current, preset, preserveTaskStatus: true };
  if (preset === 'reading') return { ...common, toggles: 'sections', tasks: 'bullets', preserveTaskStatus: false, columns: 'preserve', fontSize: 11, databasePages: 'content' };
  if (preset === 'print') return { ...common, toggles: 'sections', tasks: 'bullets', preserveTaskStatus: false, columns: 'preserve', fontSize: 10, databasePages: 'content' };
  return { ...common, toggles: 'expanded', tasks: 'checkboxes', columns: 'preserve', fontSize: 11, databasePages: 'all' };
}
