export type Severity = 'info' | 'warning' | 'error';
export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  pageId?: string;
  blockId?: string;
}

export interface Inline {
  text: string;
  propertyIcon?: 'title' | 'formula' | 'text';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  script?: 'sub' | 'sup';
  checkbox?: boolean;
  code?: boolean;
  color?: string;
  background?: string;
  href?: string;
  equation?: string;
}

export type BlockType =
  | 'paragraph' | 'heading' | 'list' | 'listItem' | 'task'
  | 'toggle' | 'tab' | 'columns' | 'column' | 'callout' | 'quote'
  | 'divider' | 'image' | 'table' | 'tableRow' | 'tableCell'
  | 'code' | 'equation' | 'bookmark' | 'pageLink' | 'file' | 'unsupported';

export interface IconFields {
  icon?: string;
  iconSymbol?: 'bookmark' | 'exclamation-mark';
  iconColor?: string;
  iconSrc?: string;
}

export interface Block extends IconFields {
  id: string;
  type: BlockType;
  keyColumn?: number;
  content: Inline[];
  children: Block[];
  level?: number;
  ordered?: boolean;
  start?: number;
  listStyle?: '1' | 'a' | 'A' | 'i' | 'I';
  checked?: boolean;
  width?: number;
  color?: string;
  background?: string;
  src?: string;
  imageWidth?: number;
  imageWidthPercent?: number;
  imageAlign?: 'left' | 'center' | 'right';
  description?: Inline[];
  preview?: string;
  mediaKind?: 'video' | 'audio' | 'embed' | 'pdf';
  alt?: string;
  caption?: Inline[];
  href?: string;
  language?: string;
  header?: boolean;
  colspan?: number;
  rowspan?: number;
}

export interface DocumentPage extends IconFields {
  id: string;
  title: string;
  sourcePath: string;
  blocks: Block[];
  properties?: Block[];
  cover?: string;
  font?: 'sans' | 'serif' | 'mono';
  parentId?: string;
  issues: Issue[];
}

export interface Asset {
  id: string;
  mime: string;
  dataUrl: string;
}

export interface Snapshot {
  version: 1;
  id: string;
  name: string;
  importedAt: string;
  pages: DocumentPage[];
  assets: Record<string, Asset>;
  issues: Issue[];
}

export interface PageSummary {
  id: string;
  title: string;
  icon?: string;
  parentId?: string;
  sourcePath: string;
  blockCount: number;
  hasBodyContent: boolean;
  propertyCount: number;
  issues: Issue[];
}

export interface ImportSummary {
  id: string;
  name: string;
  pages: PageSummary[];
  assetCount: number;
  issues: Issue[];
}

export function countBlocks(blocks: Block[]): number {
  return blocks.reduce((total, block) => total + 1 + countBlocks(block.children), 0);
}

export function hasBodyContent(page: DocumentPage): boolean {
  const meaningful = (blocks: Block[]): boolean => blocks.some(block =>
    block.type === 'image' || !!block.href || block.content.some(item => item.text.trim() || item.equation !== undefined || item.checkbox !== undefined) || meaningful(block.children));
  return meaningful(page.blocks);
}

export function summarize(snapshot: Snapshot): ImportSummary {
  return {
    id: snapshot.id,
    name: snapshot.name,
    assetCount: Object.keys(snapshot.assets).length,
    issues: snapshot.issues,
    pages: snapshot.pages.map(page => ({
      id: page.id, title: page.title, icon: page.icon, parentId: page.parentId,
      sourcePath: page.sourcePath, blockCount: countBlocks([...page.blocks, ...(page.properties ?? [])]), issues: page.issues,
      hasBodyContent: hasBodyContent(page), propertyCount: (page.properties ?? []).reduce((sum, block) => sum + (block.type === 'table' ? block.children.length : 1), 0),
    })),
  };
}
