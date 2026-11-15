import { expect, test } from 'vitest'
import { urlBase64ToUint8Array } from './push'

test('urlBase64ToUint8Array decodes base64url without padding', () => {
  expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239])
})
