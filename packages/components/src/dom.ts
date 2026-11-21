// Tooltips and popups as DOM nodes. Text a node publishes (names, units, URLs) reaches the page only
// through textContent, never as an HTML string, so it can never be read as markup.

export interface TextLine {
  text: string
  bold?: boolean
  /** de-emphasised (e.g. the node key under its name) */
  muted?: boolean
}

/** Minimal document interface, so the builder can be tested without a browser. */
export type DocumentLike = Pick<Document, 'createElement'>

/** A block of text lines, one per row; empty entries are skipped. */
export function textLines(lines: (TextLine | string | false | null | undefined)[], doc: DocumentLike = document): HTMLElement {
  const box = doc.createElement('div')
  for (const line of lines) {
    if (!line) continue
    const l = typeof line === 'string' ? { text: line } : line
    const row = doc.createElement('div')
    if (l.bold) {
      const b = doc.createElement('b')
      b.textContent = l.text
      row.append(b)
    } else {
      row.textContent = l.text
    }
    if (l.muted) row.style.opacity = '0.75'
    box.append(row)
  }
  return box
}
