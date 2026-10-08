import { renderA4 } from './a4-renderer';
import { PrintDocument } from './document.model';
import { renderReceipt } from './receipt-renderer';

/** Renders a document with the layout of its paper size. */
export function renderDocument(doc: PrintDocument, now = new Date()): Promise<Buffer> {
  return doc.paper === '80mm' ? renderReceipt(doc, now) : renderA4(doc, now);
}
