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
  const note = 'Let the final word land.'
  await page.getByRole('textbox', { name: 'What did you hear, and what will you try next?' }).fill(note)
  await page.getByRole('button', { name: 'Save reflection' }).click()
  await expect(page.getByText('Reflection saved with this take.')).toBeVisible()
  const originalAudio = await page.getByLabel('Your completed take').getAttribute('src')
  await page.getByRole('button', { name: 'Practice again — no extra notes' }).click()
  await expect(page.getByText('Your saved focus:', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.getByRole('button', { name: 'Check my take' }).click()
  await expect(page.getByRole('heading', { name: 'Extra practice saved', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Extra practice saved', exact: true })).toBeVisible()
  const repeated = await (await page.request.get('/api/v1/me')).json()
  await expect(page.getByText('Your focus for this take:')).toBeVisible()
  await expect(page.getByLabel('Previous take for comparison')).toHaveAttribute('src', originalAudio!)
  expect(repeated.progress.notes_total).toBe(before.progress.notes_total)
  expect(repeated.progress.practice_seconds_total).toBeGreaterThan(before.progress.practice_seconds_total)
  await page.getByRole('button', { name: /First completion attempt · saved/ }).click()
  await expect(page.getByLabel('Your completed take')).toHaveAttribute('src', originalAudio!)
  await expect(page.getByRole('textbox', { name: 'What did you hear, and what will you try next?' })).toHaveValue(note)
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


test('reload after an accepted upload resumes its check and saves exactly one attempt', async ({ page }) => {
  const lesson = await seed(page)
  const item = lesson.items.find((value) => value.task.verification.type === 'recording')!
  const before = await (await page.request.get('/api/v1/me')).json()
  let uploads = 0
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/recordings') uploads++ })
  await page.route('**/api/v1/jobs/**', (route) => route.abort('internetdisconnected'))
  await page.goto('/exercise/' + item.id)
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/recordings' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Check my take' }).click()
  const response = await accepted
  expect(response.status()).toBe(202)
  const uploaded = await response.json()
  const state = await (await page.request.get('/api/v1/plan-items/' + item.id)).json()
  expect(state.pending_take.recording_id).toBe(uploaded.recording.id)
  await page.reload()
  await expect(page.getByText('Checking your saved take. You can return here after leaving this page.')).toBeVisible()
  await page.unroute('**/api/v1/jobs/**')
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const after = await (await page.request.get('/api/v1/me')).json()
  expect(after.progress.notes_total).toBe(before.progress.notes_total + state.item.notes_available)
  expect(uploads).toBe(1)
  const takes = await (await page.request.get('/api/v1/exercise-attempts?plan_item_id=' + item.id)).json()
  expect(takes.items.filter((take: { recording_id: string }) => take.recording_id === uploaded.recording.id)).toHaveLength(1)
  await page.reload()
  await expect(page.getByLabel('Your completed take')).toBeVisible()
  expect((await (await page.request.get('/api/v1/me')).json()).progress.notes_total).toBe(after.progress.notes_total)
})

test('a completed session keeps its exercises reachable for feedback and extra practice', async ({ page }) => {
  test.setTimeout(90_000)
  const lesson = await seed(page)
  await page.goto('/today')
  for (const item of lesson.items) {
    await page.getByRole('link', { name: item.title, exact: true }).click()
    if (item.task.verification.type === 'self_confirmation') {
      await page.getByRole('checkbox', { name: 'I practiced this exercise' }).check()
      await page.getByRole('button', { name: 'Complete', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'Start recording', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
      await page.waitForTimeout(4000)
      await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
      await page.getByRole('button', { name: 'Check my take' }).click()
    }
    await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Back', exact: true }).click()
  }
  await page.getByRole('link', { name: /^Finish session/ }).click()
  await expect(page.getByRole('heading', { name: 'Nice session!' })).toBeVisible()
  const before = await (await page.request.get('/api/v1/me')).json()
  await page.getByRole('link', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Done for today' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review or practice again' })).toBeVisible()
  const recording = lesson.items.find((item) => item.task.verification.type === 'recording')!
  await page.getByRole('link', { name: recording.title + ', done', exact: true }).click()
  await expect(page.getByLabel('Your completed take')).toBeVisible()
  await page.getByRole('button', { name: 'Practice again — no extra notes' }).click()
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel extra practice' }).click()
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(before.progress)
})

test('baseline resumes an accepted upload after reload and finishes all three recording checks', async ({ page }) => {
  test.setTimeout(75_000)
  expect((await page.request.post('/api/v1/guest-session', { headers: { 'Idempotency-Key': randomUUID() }, data: { goal: 'clear_speech', timezone: 'UTC', locale: 'en-US', consent: { audio_processing: true, policy_version: '2026-11-14' } } })).ok()).toBe(true)
  const created = await page.request.post('/api/v1/assessments', { headers: { 'Idempotency-Key': randomUUID() }, data: { kind: 'initial', recording_conditions: { device_label: 'Browser test microphone', distance_cm: 50, environment: 'quiet_room' } } })
  expect(created.status()).toBe(201)
  const assessment = await created.json()
  let uploads = 0
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/recordings') uploads++ })
  await page.goto('/record?assessment_id=' + assessment.id)
  await page.route('**/api/v1/jobs/**', (route) => route.abort('internetdisconnected'))
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: 'Start recording', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
    await page.waitForTimeout(9000)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/recordings' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Use this take', exact: true }).click()
    expect((await accepted).status()).toBe(202)
    if (index === 0) {
      await page.reload()
      await page.unroute('**/api/v1/jobs/**')
    }
    if (index < 2) await expect(page.getByRole('heading', { name: index === 0 ? 'Read this unfamiliar passage' : 'Read with expression', exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: 'All 3 tasks recorded' })).toBeVisible()
  expect(uploads).toBe(3)
  const saved = await (await page.request.get('/api/v1/assessments/' + assessment.id)).json()
  expect(saved.tasks.every((task: { quality_status: string; pending_take: unknown }) => task.quality_status === 'accepted' && task.pending_take === null)).toBe(true)
  // Stop before the separate paid full-profile analysis.
})

test('cancel during a delayed upload acknowledgment leaves no recoverable extra take', async ({ page }) => {
  test.setTimeout(65_000)
  const lesson = await seed(page)
  const item = lesson.items.find((value) => value.task.verification.type === 'recording')!
  await page.goto('/exercise/' + item.id)
  const record = async () => {
    await page.getByRole('button', { name: 'Start recording', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.getByRole('button', { name: 'Check my take', exact: true }).click()
  }
  await record()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const before = await (await page.request.get('/api/v1/me')).json()
  let release!: () => void
  let uploaded: { recording: { id: string } } | undefined
  await page.route('**/api/v1/recordings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    expect(response.status()).toBe(202)
    uploaded = await response.json()
    await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Practice again — no extra notes' }).click()
  await record()
  await expect.poll(() => uploaded?.recording.id).toBeTruthy()
  await page.getByRole('button', { name: 'Cancel extra practice' }).click()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  expect((await (await page.request.get('/api/v1/plan-items/' + item.id)).json()).pending_take).toBeNull()
  release()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const takes = await (await page.request.get('/api/v1/exercise-attempts?plan_item_id=' + item.id)).json()
  expect(takes.items.some((take: { recording_id: string }) => take.recording_id === uploaded!.recording.id)).toBe(false)
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(before.progress)
})
