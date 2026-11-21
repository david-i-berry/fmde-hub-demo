// textLines puts text into the page only as text, never as markup. Tested against a minimal fake
// document (the components' tests run without a browser DOM).
import { describe, expect, it } from 'vitest'
import { textLines, type DocumentLike } from '../src/dom'

interface FakeElement {
  tag: string
  textContent: string
  children: FakeElement[]
  style: Record<string, string>
  append(...c: FakeElement[]): void
  innerHTML?: string
}

const fakeDocument = {
  createElement(tag: string) {
    const el: FakeElement = {
      tag,
      textContent: '',
      children: [],
      style: {},
      append(...c) {
        el.children.push(...c)
      },
    }
    // markup must never be assigned
    Object.defineProperty(el, 'innerHTML', { set: () => { throw new Error('innerHTML used') } })
    return el
  },
} as unknown as DocumentLike

describe('textLines', () => {
  it('keeps markup in node-supplied text as plain text', () => {
    const name = `<img src=x onerror="alert('x')">`
    const box = textLines([{ text: name, bold: true }, { text: 'g/n', muted: true }, 'plain', '', null, false], fakeDocument) as unknown as FakeElement
    expect(box.children).toHaveLength(3)
    const [first, second, third] = box.children
    expect(first!.children[0]).toMatchObject({ tag: 'b', textContent: name })
    expect(second).toMatchObject({ textContent: 'g/n', style: { opacity: '0.75' } })
    expect(third).toMatchObject({ tag: 'div', textContent: 'plain' })
  })
})
