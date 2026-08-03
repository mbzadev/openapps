const encoder = new TextEncoder()

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const derived = await deriveCloudflarePbkdf2(encoder.encode(password), salt)
  return `pbkdf2-sha256-cf-v1$600000$${bytesToBase64(salt)}$${bytesToBase64(derived)}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsRaw, saltRaw, expectedRaw] = encoded.split('$')
  if (algorithm !== 'pbkdf2-sha256-cf-v1' || iterationsRaw !== '600000' || !saltRaw || !expectedRaw) return false
  const iterations = Number(iterationsRaw)
  if (!Number.isSafeInteger(iterations) || iterations < 1) return false
  const salt = base64ToBytes(saltRaw)
  const expected = base64ToBytes(expectedRaw)
  const actualBytes = await deriveCloudflarePbkdf2(encoder.encode(password), salt)
  if (actualBytes.byteLength !== expected.byteLength) return false
  let difference = 0
  for (let index = 0; index < actualBytes.byteLength; index++) difference |= actualBytes[index]! ^ expected[index]!
  return difference === 0
}

async function deriveCloudflarePbkdf2(initial: Uint8Array, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  let material = new Uint8Array(initial)
  for (let round = 0; round < 6; round++) {
    const roundSalt = new Uint8Array(salt.byteLength + 1)
    roundSalt.set(salt)
    roundSalt[salt.byteLength] = round
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits'])
    material = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: roundSalt, iterations: 100_000 },
      key,
      256,
    ))
  }
  return material
}
