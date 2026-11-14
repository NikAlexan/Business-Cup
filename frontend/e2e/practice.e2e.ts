import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

async function seed(page: Page) {
  const guest = await page.request.post('/api/v1/guest-session', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { goal: 'clear_speech', timezone: 'UTC', locale: 'en-US', consent: { audio_processing: true, policy_version: '2026-11-14' } },
  })
  expect(guest.ok()).toBe(true)
  const seeded = await page.request.post('/api/v1/demo/seed')
  expect(seeded.ok()).toBe(true)
  const today = await page.request.get('/api/v1/today')
  return (await today.json()).lesson as { id: string; items: { id: string; title: string; task: { verification: { type: string } } }[] }
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1)
}

test('keyboard onboarding reaches a working microphone setup against the real API', async ({ page }) => {
  await page.goto('/')
  const goal = page.getByRole('radio', { name: /Clearer speech/ })
  await goal.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: /More expressive voice/ })).toBeChecked()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.getByRole('heading', { name: "Let's check your mic" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start the 3 tasks' })).toBeEnabled()
  await noOverflow(page)
})

test('mobile recording reaches quality feedback, private playback and reload without duplicate reward', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const lesson = await seed(page)
  const recording = lesson.items.find((item) => item.task.verification.type === 'recording')!
  await page.goto('/today')
  await page.getByRole('link', { name: recording.title, exact: true }).click()
  await noOverflow(page)
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
  await page.waitForTimeout(4000) // Record real synthetic microphone audio for VAD, not a mocked upload.
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await expect(page.locator('audio')).toBeVisible()
  await page.getByRole('button', { name: 'Check my take' }).click()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const audio = page.getByLabel('Your completed take')
  await expect(audio).toBeVisible()
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThan(0)
  const before = await (await page.request.get('/api/v1/me')).json()
  await page.reload()
  await expect(page.getByLabel('Your completed take')).toBeVisible()
  await noOverflow(page)
  const after = await (await page.request.get('/api/v1/me')).json()
  expect(after.progress.notes_total).toBe(before.progress.notes_total)
  expect(after.progress.practice_seconds_total).toBe(before.progress.practice_seconds_total)
  expect(after.progress.practice_seconds_total).toBeGreaterThan(0)
  const originalAudio = await page.getByLabel('Your completed take').getAttribute('src')
  await page.getByRole('button', { name: 'Practice again — no extra notes' }).click()
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.getByRole('button', { name: 'Check my take' }).click()
  await expect(page.getByRole('heading', { name: 'Extra practice saved', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Extra practice saved', exact: true })).toBeVisible()
  const repeated = await (await page.request.get('/api/v1/me')).json()
  expect(repeated.progress.notes_total).toBe(before.progress.notes_total)
  expect(repeated.progress.practice_seconds_total).toBeGreaterThan(before.progress.practice_seconds_total)
  await page.getByRole('button', { name: /First completion attempt · saved/ }).click()
  await expect(page.getByLabel('Your completed take')).toHaveAttribute('src', originalAudio!)
  await noOverflow(page)
})

test('cancelling a pending browser microphone request releases its eventual live track', async ({ page }) => {
  const lesson = await seed(page)
  const recording = lesson.items.find((item) => item.task.verification.type === 'recording')!
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const state = window as Window & { testStream?: MediaStream }
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints)
      state.testStream = stream
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return stream
    }
  })
  await page.goto('/exercise/' + recording.id)
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel microphone request' }).click()
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as Window & { testStream?: MediaStream }).testStream?.getTracks()[0]?.readyState)).toBe('ended')
})
