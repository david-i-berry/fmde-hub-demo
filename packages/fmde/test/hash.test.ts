// sha256Hex against the NIST FIPS 180-4 example values (SHA-256 "abc" and two-block messages)
// and the well-known digest of the empty input.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../src/hash'

describe('sha256Hex', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches the published SHA-256 test vectors', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('hashes the parts concatenated, strings as UTF-8', async () => {
    const abc = await sha256Hex('abc')
    expect(await sha256Hex('a', 'bc')).toBe(abc)
    expect(await sha256Hex(new Uint8Array([0x61, 0x62]), 'c')).toBe(abc)
    // non-ASCII is hashed as its UTF-8 bytes
    expect(await sha256Hex('°C')).toBe(await sha256Hex(new Uint8Array([0xc2, 0xb0, 0x43])))
  })

  it('throws a clear error without Web Crypto (a non-secure browser context)', async () => {
    vi.stubGlobal('crypto', undefined)
    await expect(sha256Hex('abc')).rejects.toThrow(/https or on localhost/)
  })
})
