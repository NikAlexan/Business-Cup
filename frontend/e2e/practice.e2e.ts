import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

async function seed(page: Page) {
  const guest = await page.request.post('/api/v1/guest-session', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { goal: 'clear_speech', timezone: 'UTC', locale: 'en-US', consent: { audio_processing: true, policy_version: '2026-11-14' } },
  })
  expect(guest.ok()).toBe(true)
  const seeded = await page.request.post('/api/v1/demo/seed')
  expect(seeded.ok()).toBe(true)
  const today = await page.request.get('/api/v1/today')
  return (await today.json()).lesson as { id: string; items: { id: string; exercise_id: string; title: string; task: { verification: { type: string } } }[] }
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
  await page.getByRole('textbox', { name: 'Your listening note' }).fill(note)
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
  await expect(page.getByRole('textbox', { name: 'Your listening note' })).toHaveValue(note)
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
  const plan = await (await page.request.get('/api/v1/plan')).json()
  const future = plan.lessons.find((value: { status: string }) => value.status === 'locked').items.find((value: { task: { verification: { type: string } } }) => value.task.verification.type === 'recording')
  await page.goto('/exercise/' + future.id)
  await expect(page.getByRole('heading', { name: 'Session not open yet', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check availability', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Session not open yet', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to today', exact: true }).click()
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
  test.setTimeout(75_000) // Three nine-second takes plus real VAD/worker processing, also on slower CI.
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

test('unconfirmed cancellation survives reload before any completed extra take can auto-save', async ({ page }) => {
  test.setTimeout(65_000)
  const lesson = await seed(page)
  const item = lesson.items.find((value) => value.task.verification.type === 'recording')!
  await page.goto('/exercise/' + item.id)
  const record = async () => {
    await page.getByRole('button', { name: 'Start recording', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.getByRole('button', { name: 'Check my take' }).click()
  }
  await record()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const before = await (await page.request.get('/api/v1/me')).json()
  let release!: () => void
  let uploaded: { recording: { id: string }; job_id: string } | undefined
  await page.route('**/api/v1/recordings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    uploaded = await response.json()
    await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ response })
  })
  const cancellationRoute = '**/api/v1/recording-uploads/*/cancellation'
  let cancellations = 0
  await page.route(cancellationRoute, (route) => { cancellations++; return route.abort('internetdisconnected') })
  await page.getByRole('button', { name: 'Practice again — no extra notes' }).click()
  await record()
  await expect.poll(() => uploaded?.recording.id).toBeTruthy()
  await page.getByRole('button', { name: 'Cancel extra practice' }).click()
  await expect.poll(() => cancellations).toBe(1)
  await expect(page.getByText('Cancellation pending. The saved take will not be submitted while cancellation is being confirmed.')).toBeVisible()
  const acknowledgment = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/recordings' && response.request().method() === 'POST')
  release()
  await acknowledgment
  await page.unroute('**/api/v1/recordings')
  let extraJobPolls = 0
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/jobs/' + uploaded!.job_id) extraJobPolls++ })
  await page.reload()
  await expect.poll(() => cancellations).toBe(2)
  await expect(page.getByText('Cancellation pending. The saved take will not be submitted while cancellation is being confirmed.')).toBeVisible()
  expect(extraJobPolls).toBe(0)
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toHaveCount(0)
  await page.unroute(cancellationRoute)
  await page.getByRole('button', { name: 'Cancel extra practice' }).click()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const takes = await (await page.request.get('/api/v1/exercise-attempts?plan_item_id=' + item.id)).json()
  expect(takes.items.some((take: { recording_id: string }) => take.recording_id === uploaded!.recording.id)).toBe(false)
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(before.progress)
})

test('a chosen change transfers from a drill to narration and remains on Today after a listening check', async ({ page }) => {
  test.setTimeout(75_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const lesson = await seed(page)
  const drill = lesson.items.find((item) => item.exercise_id !== 'E12' && item.task.verification.type === 'recording')!
  const story = lesson.items.find((item) => item.exercise_id === 'E12')!
  await page.goto('/exercise/' + drill.id)
  const record = async (extra = false) => {
    await page.getByRole('button', { name: 'Start recording', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.getByRole('button', { name: 'Check my take' }).click()
    await expect(page.getByRole('heading', { name: extra ? 'Extra practice saved' : 'Practice complete', exact: true })).toBeVisible()
  }
  await record()
  const focus = 'Keep the pause that lets this thought land.'
  await page.getByRole('textbox', { name: 'Your listening note' }).fill(focus)
  await page.getByRole('combobox', { name: 'Focus for story practice' }).selectOption('pauses')
  await page.getByRole('radio', { name: 'Keep a useful feature', exact: true }).check()
  await page.getByRole('button', { name: 'Save for story practice' }).click()
  await page.getByRole('link', { name: 'Open the story' }).click()
  await expect(page).toHaveURL(new RegExp('/exercise/' + story.id + '$'))
  await expect(page.getByRole('heading', { name: 'One focus for this story' })).toBeVisible()
  await expect(page.getByText('Keep a useful feature', { exact: true })).toBeVisible()
  await noOverflow(page)
  await record()
  await expect(page.getByRole('heading', { name: 'Focus used for this take' })).toBeVisible()
  const focusedState = await (await page.request.get('/api/v1/plan-items/' + story.id)).json()
  expect(focusedState.training_focus.intent).toBe('keep')
  const firstStoryAudio = await page.getByLabel('Your completed take').getAttribute('src')
  const before = await (await page.request.get('/api/v1/me')).json()
  await page.getByRole('button', { name: 'Partly', exact: true }).click()
  await expect(page.getByText('Listening check saved with this take.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Partly', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await noOverflow(page)
  await page.getByRole('link', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Keep what worked' })).toBeVisible()
  await expect(page.getByText('Last story: you marked “Partly”.')).toBeVisible()
  await noOverflow(page)
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(before.progress)
  await page.getByRole('link', { name: 'Open story practice', exact: true }).click()
  await page.getByRole('button', { name: 'Practice again — no extra notes', exact: true }).click()
  await record(true)
  const extraStoryAudio = await page.getByLabel('Your completed take').getAttribute('src')
  expect(extraStoryAudio).not.toBe(firstStoryAudio)
  let release!: () => void
  let ready!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const saved = new Promise<void>((resolve) => { ready = resolve })
  await page.route('**/api/v1/exercise-attempts/*/focus-check', async (route) => {
    const response = await route.fetch()
    ready()
    await held
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Partly', exact: true }).click()
  await saved
  await page.getByRole('button', { name: /First completion attempt · saved/ }).click()
  await expect(page.getByLabel('Your completed take')).toHaveAttribute('src', firstStoryAudio!)
  const refreshedHistory = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/exercise-attempts' && url.searchParams.get('plan_item_id') === story.id
  })
  release()
  await refreshedHistory // The late save's callback has run and refreshed its history.
  await page.unroute('**/api/v1/exercise-attempts/*/focus-check')
  await expect(page.getByLabel('Your completed take')).toHaveAttribute('src', firstStoryAudio!)
  await page.getByRole('button', { name: /Extra practice · saved/ }).click()
  await expect(page.getByRole('button', { name: 'Partly', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Your completed take')).toHaveAttribute('src', extraStoryAudio!)
  expect((await (await page.request.get('/api/v1/me')).json()).progress.notes_total).toBe(before.progress.notes_total)
  await noOverflow(page)
})

test('baseline and check-in recover failed analysis, expose limitations and compare saved private recordings', async ({ page }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await page.request.post('/api/v1/guest-session', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { goal: 'clear_speech', timezone: 'UTC', locale: 'en-US', consent: { audio_processing: true, policy_version: '2026-11-14' } },
  })).ok()).toBe(true)
  let uploads = 0
  let submits = 0
  let retries = 0
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/recordings') uploads++
    if (path.endsWith('/submit')) submits++
    if (path.endsWith('/retry')) retries++
  })
  const run = async (kind: 'initial' | 'reassessment') => {
    const created = await page.request.post('/api/v1/assessments', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { kind, recording_conditions: { device_label: 'Browser fixture mic', distance_cm: 50, environment: 'quiet_room' }, demo_override: kind === 'reassessment' },
    })
    expect(created.status()).toBe(201)
    const assessment = await created.json()
    await page.goto('/record?assessment_id=' + assessment.id)
    for (let index = 0; index < 3; index++) {
      await page.getByRole('button', { name: 'Start recording', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
      await page.waitForTimeout(9000)
      await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
      await page.getByRole('button', { name: 'Use this take', exact: true }).click()
      await expect(page.getByRole('heading', { name: index === 0 ? 'Read this unfamiliar passage' : index === 1 ? 'Read with expression' : 'All 3 tasks recorded', exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Build my voice profile', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry analysis', exact: true })).toBeVisible()
    const failed = await (await page.request.get('/api/v1/assessments/' + assessment.id)).json()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Retry analysis', exact: true })).toBeVisible()
    // Recover the job from assessment metadata even when the saved URL has no job parameter.
    await page.goto('/analyzing?assessment_id=' + assessment.id)
    await page.getByRole('button', { name: 'Retry analysis', exact: true }).click()
    await expect(page.getByRole('heading', { name: kind === 'initial' ? 'Your voice profile' : 'Your check-in', exact: true })).toBeVisible()
    await expect(page.getByText('Test-only report from a deterministic provider; no AI listening assessment was performed.')).toBeVisible()
    const saved = await (await page.request.get('/api/v1/assessments/' + assessment.id)).json()
    expect(saved.job_id).toBe(failed.job_id)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Keep in mind', exact: true })).toBeVisible()
    await noOverflow(page)
    return saved
  }
  const baseline = await run('initial')
  await expect(page.getByLabel('Control passage recording')).toHaveAttribute('src', '/api/v1/recordings/' + baseline.tasks[0].recording_id + '/audio')
  const checkin = await run('reassessment')
  expect(checkin.comparison.comparable).toBe(true)
  await expect(page.getByLabel('Before: control_text')).toHaveAttribute('src', '/api/v1/recordings/' + baseline.tasks[0].recording_id + '/audio')
  await expect(page.getByLabel('After: control_text')).toHaveAttribute('src', '/api/v1/recordings/' + checkin.tasks[0].recording_id + '/audio')
  await expect(page.getByText('These unfamiliar passages use different texts; compare the delivery rather than matching individual words.')).toBeVisible()
  expect(uploads).toBe(6)
  expect(submits).toBe(2)
  expect(retries).toBe(2)
  await page.getByRole('link', { name: 'See my new plan' }).click()
  await expect(page.getByRole('heading', { name: 'Your plan', exact: true })).toBeVisible()
  await expect(page.getByText('Session 1 of 14', { exact: true })).toBeVisible()
})


test('audible pause contrast reconciles an old save and recovers a newly discovered take in another open tab', async ({ page }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await page.request.post('/api/v1/guest-session', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { goal: 'expressive_voice', timezone: 'UTC', locale: 'en-US', consent: { audio_processing: true, policy_version: '2026-11-14' } },
  })).ok()).toBe(true)
  // Real uploads and queue; the report/timestamps come from the explicit deterministic test provider.
  const created = await page.request.post('/api/v1/assessments', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { kind: 'initial', recording_conditions: { device_label: 'Fixture mic', distance_cm: 20, environment: 'quiet_room' } },
  })
  expect(created.status()).toBe(201)
  const assessment = await created.json()
  const buffer = await readFile('.browser-fixtures/speech.wav')
  const terminalJob = async (id: string) => {
    await expect.poll(async () => (await (await page.request.get('/api/v1/jobs/' + id)).json()).status,
      { timeout: 45_000, intervals: [300, 600, 1000] }).toMatch(/^(completed|failed)$/)
    return (await (await page.request.get('/api/v1/jobs/' + id)).json()).status
  }
  for (const task of assessment.tasks) {
    const upload = await page.request.post('/api/v1/recordings', {
      headers: { 'Idempotency-Key': randomUUID() },
      multipart: { purpose: 'assessment', assessment_id: assessment.id, task_id: task.id,
        file: { name: 'speech.wav', mimeType: 'audio/wav', buffer } },
    })
    expect(upload.status()).toBe(202)
    expect(await terminalJob((await upload.json()).job_id)).toBe('completed')
  }
  const submitted = await page.request.post('/api/v1/assessments/' + assessment.id + '/submit', {
    headers: { 'Idempotency-Key': randomUUID() }, data: {},
  })
  expect(submitted.status()).toBe(202)
  const analysisId = (await submitted.json()).job_id
  expect(await terminalJob(analysisId)).toBe('failed')
  expect((await page.request.post('/api/v1/jobs/' + analysisId + '/retry', {
    headers: { 'Idempotency-Key': randomUUID() }, data: {},
  })).ok()).toBe(true)
  expect(await terminalJob(analysisId)).toBe('completed')
  const today = await (await page.request.get('/api/v1/today')).json()
  const item = today.lesson.items.find((value: { exercise_id: string }) => value.exercise_id === 'E08')!
  expect(item).toBeTruthy()
  const state = await (await page.request.get('/api/v1/plan-items/' + item.id)).json()
  const progress = (await (await page.request.get('/api/v1/me')).json()).progress
  await page.goto('/exercise/' + item.id)
  await page.getByText('Listen to a short pause comparison', { exact: true }).click()
  const first = page.getByLabel('Pause example A')
  const second = page.getByLabel('Pause example B')
  await first.evaluate((audio: HTMLAudioElement) => audio.play())
  await expect.poll(() => first.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false)
  await second.evaluate((audio: HTMLAudioElement) => audio.play())
  await expect.poll(() => first.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  await expect.poll(() => second.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false)
  await page.getByRole('radio', { name: 'Not sure', exact: true }).check()
  const firstBoundary = state.listening_boundaries[0]
  await page.getByRole('radio', { name: firstBoundary.before + ' / ' + firstBoundary.after, exact: true }).check()
  const keys: string[] = []
  await page.route('**/api/v1/plan-items/' + item.id + '/listening-plan', async (route) => {
    keys.push(route.request().headers()['idempotency-key'])
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    if (keys.length === 1) await route.abort('connectionfailed') // The server committed A, but its reply was lost.
    else await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Use this boundary for my take' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  const boundary = state.listening_boundaries[1]
  expect((await page.request.post('/api/v1/plan-items/' + item.id + '/listening-plan', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { example_id: state.listening_example.id, answer: 'b', boundary_index: 1 },
  })).status()).toBe(201)
  await page.getByRole('button', { name: 'Use this boundary for my take' }).click()
  await expect(page.getByText('A newer boundary was saved elsewhere. The latest saved boundary is shown below.')).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  await expect(page.getByRole('radio', { name: 'Version B', exact: true })).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Boundary for this take', exact: true })).toBeVisible()
  const plan = (await (await page.request.get('/api/v1/plan-items/' + item.id)).json()).listening_plan
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(progress)
  // Play once more, then starting the microphone must stop reference audio immediately.
  await second.evaluate((audio: HTMLAudioElement) => audio.play())
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
  expect(await second.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  await expect(second).toBeHidden()
  const observer = await page.context().newPage()
  await observer.goto('/exercise/' + item.id)
  await expect(observer.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible()
  // A later choice is for a future take; the current recording retains the explicit start-time choice.
  expect((await page.request.post('/api/v1/plan-items/' + item.id + '/listening-plan', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { example_id: plan.example.id, answer: 'a', boundary_index: 0 },
  })).status()).toBe(201)
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.route('**/api/v1/jobs/**', (route) => route.abort('internetdisconnected'))
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/recordings' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Check my take' }).click()
  expect((await accepted).status()).toBe(202)
  // The other page is already mounted. An ordinary stale-query focus refresh must discover this take.
  await observer.waitForTimeout(10_100)
  await observer.bringToFront()
  await observer.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(observer.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  await expect(observer.getByText(/This does not judge the phrasing/)).toBeVisible()
  await observer.close()
  await page.unroute('**/api/v1/jobs/**')
  const completed = await (await page.request.get('/api/v1/plan-items/' + item.id)).json()
  const attempt = await (await page.request.get('/api/v1/exercise-attempts/' + completed.item.latest_attempt_id)).json()
  expect(attempt.listening_plan.id).toBe(plan.id)
  expect(attempt.listening_plan.boundary_word_index).toBe(boundary.word_index)
  expect(attempt.feedback.planned_pause.available).toBe(true)
  await page.reload()
  await expect(page.getByText(/This does not judge the phrasing/)).toBeVisible()
  await page.getByRole('button', { name: /Hear your chosen boundary:/ }).click()
  const ownAudio = page.getByLabel('Your completed take')
  await expect.poll(() => ownAudio.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0)
  await expect.poll(() => ownAudio.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false)
  await noOverflow(page)
})

test('a saved listening-first decision overrides legacy model advice and retains private playback', async ({ page }) => {
  const lesson = await seed(page)
  const item = lesson.items.find((value) => value.task.verification.type === 'recording')!
  await page.goto('/exercise/' + item.id)
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.getByRole('button', { name: 'Check my take' }).click()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const state = await (await page.request.get('/api/v1/plan-items/' + item.id)).json()
  const id = state.item.latest_attempt_id
  const saved = await page.request.put('/api/v1/exercise-attempts/' + id + '/reflection', { data: { note: '', intent: 'undecided' } })
  expect(saved.status()).toBe(200)
  const progress = (await (await page.request.get('/api/v1/me')).json()).progress
  const fixture = JSON.parse(await readFile('../docs/improvements/evaluations/live-human-undecided-v3-2026-11-15.json', 'utf8'))
  // Inject a legacy model report only. Recording, cookie ownership, reflection and playback use the real API.
  // This checks UI policy under an untrusted suggestion, not the model's judgment of this browser recording.
  await page.route('**/api/v1/exercise-attempts/' + id, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.speech_review = { status: 'completed', job_id: null, report: fixture.report }
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await expect(page.getByText('Listening hypothesis', { exact: true })).toBeVisible()
  await expect(page.getByText('Your listening step:', { exact: true })).toBeVisible()
  const guide = page.getByRole('region', { name: 'Speech coaching', exact: true })
  await expect(guide).not.toContainText(fixture.report.next_step)
  await expect(guide).not.toContainText(fixture.report.listening_question)
  await expect(guide).toContainText('What do you hear in this phrase, and is there enough reason to choose a change?')
  await page.getByRole('button', { name: 'Listen to “the two men”', exact: true }).click()
  const audio = page.getByLabel('Your completed take')
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0)
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(progress)
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
})


test('a stale reflection save keeps its draft, refreshes the decision and requires an explicit conflict choice', async ({ page }) => {
  const lesson = await seed(page)
  const item = lesson.items.find((value) => value.task.verification.type === 'recording')!
  await page.goto('/exercise/' + item.id)
  await page.getByRole('button', { name: 'Start recording', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
  await page.getByRole('button', { name: 'Check my take' }).click()
  await expect(page.getByRole('heading', { name: 'Practice complete', exact: true })).toBeVisible()
  const state = await (await page.request.get('/api/v1/plan-items/' + item.id)).json()
  const path = '/api/v1/exercise-attempts/' + state.item.latest_attempt_id + '/reflection'
  const initial = await page.request.put(path, { data: { note: 'My original listening note.', intent: 'experiment', expected_revision: 0 } })
  expect(initial.status()).toBe(200)
  expect((await initial.json()).reflection.revision).toBe(1)
  await page.reload()
  const note = page.getByRole('textbox', { name: 'Your listening note' })
  await expect(note).toHaveValue('My original listening note.')
  await note.fill('My retained browser draft.')
  const progress = (await (await page.request.get('/api/v1/me')).json()).progress
  // Another tab/device writes to the actual API while this page still has revision 1.
  const remote = await page.request.put(path, { data: { note: 'Listen once more before choosing.', intent: 'undecided', expected_revision: 1 } })
  expect(remote.status()).toBe(200)
  const bodies: Record<string, unknown>[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname === path && request.method() === 'PUT') bodies.push(request.postDataJSON()) })
  const conflict = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click()
  expect((await conflict).status()).toBe(409)
  await expect(page.getByText('A saved reflection changed while you were editing. Your draft is kept.')).toBeVisible()
  await expect(note).toHaveValue('My retained browser draft.')
  await expect(page.getByRole('radio', { name: 'Listen again before deciding', exact: true })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Save reflection', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Keep my draft for the next save', exact: true }).click()
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click()
  await expect(page.getByText('Reflection saved with this take.')).toBeVisible()
  expect(bodies).toEqual([
    { note: 'My retained browser draft.', expected_revision: 1 },
    { note: 'My retained browser draft.', expected_revision: 2 },
  ])
  await page.reload()
  await expect(note).toHaveValue('My retained browser draft.')
  await expect(page.getByRole('radio', { name: 'Listen again before deciding', exact: true })).toBeChecked()
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(progress)
  const final = await (await page.request.get(path.replace('/reflection', ''))).json()
  expect(final.reflection).toMatchObject({ note: 'My retained browser draft.', intent: 'undecided', revision: 3 })
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
})


test('A/B self-listening survives lost replies, preserves the first answer and restores the same pair after reload', async ({ page }) => {
  test.setTimeout(100_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const lesson = await seed(page)
  const item = lesson.items.find((value) => value.task.verification.type === 'recording')!
  await page.goto('/exercise/' + item.id)
  const record = async (heading: string) => {
    await page.getByRole('button', { name: 'Start recording', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.getByRole('button', { name: 'Check my take' }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await record('Practice complete')
  await page.getByRole('textbox', { name: 'Your listening note' }).fill('Keep the last words comfortable.')
  await page.getByRole('radio', { name: 'Keep a useful feature', exact: true }).check()
  await page.getByRole('button', { name: 'Save reflection', exact: true }).click()
  await expect(page.getByText('Reflection saved with this take.')).toBeVisible()
  await page.getByRole('button', { name: 'Practice again — no extra notes', exact: true }).click()
  await record('Extra practice saved')
  const progress = (await (await page.request.get('/api/v1/me')).json()).progress
  const keys: string[] = []
  let originalId = ''
  await page.route('**/api/v1/exercise-attempts/*/comparison', async (route) => {
    keys.push(route.request().headers()['idempotency-key'])
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const data = await response.json()
    if (!originalId) originalId = data.id
    expect(data.id).toBe(originalId)
    if (keys.length === 1) await route.abort('connectionfailed')
    else await route.fulfill({ response })
  })
  const own = page.getByLabel('Your completed take')
  await own.evaluate((audio: HTMLAudioElement) => audio.play())
  const open = page.getByRole('button', { name: 'Compare with A/B labels', exact: true })
  await open.click()
  const modal = page.getByRole('dialog', { name: 'Listen to your two takes', exact: true })
  await expect(modal.getByRole('alert')).toBeVisible()
  expect(await own.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  await expect(open).toBeFocused()
  await open.click()
  await expect(modal.getByRole('radio', { name: 'I hear no clear difference', exact: true })).toBeEnabled()
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  await expect(modal.getByText('Version A · Repeated take', { exact: true })).toHaveCount(0)
  await expect(modal.getByText('Version A · Previous take', { exact: true })).toHaveCount(0)
  const a = modal.getByLabel('Comparison version A')
  const b = modal.getByLabel('Comparison version B')
  const aUrl = await a.getAttribute('src')
  await expect(a).toHaveAttribute('src', '/api/v1/listening-comparisons/' + originalId + '/audio/a')
  const bytes = await page.request.get(aUrl!, { headers: { Range: 'bytes=0-31' } })
  expect(bytes.status()).toBe(206)
  expect(bytes.headers()['cache-control']).toBe('private, no-store')
  await a.evaluate((audio: HTMLAudioElement) => audio.play())
  await b.evaluate((audio: HTMLAudioElement) => audio.play())
  expect(await a.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  expect(await b.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false)
  let writes = 0
  await page.route('**/api/v1/listening-comparisons/*/result', async (route) => {
    writes++
    const response = await route.fetch()
    expect(response.status()).toBe(writes === 1 ? 200 : 409)
    if (writes === 1) await route.abort('connectionfailed')
    else await route.fulfill({ response })
  })
  await modal.getByRole('radio', { name: 'I hear no clear difference', exact: true }).check()
  await modal.getByRole('textbox', { name: /What did you hear/ }).fill('word'.repeat(125)) // The maximum-length note must wrap in the mobile dialog.
  await modal.getByRole('button', { name: 'Save answer and reveal takes', exact: true }).click()
  await expect(modal.getByRole('alert')).toBeVisible()
  await modal.getByRole('radio', { name: 'I am not sure', exact: true }).check()
  await modal.getByRole('button', { name: 'Save answer and reveal takes', exact: true }).click()
  await expect(modal.getByText('Your first answer: I hear no clear difference', { exact: true })).toBeVisible()
  await expect(modal.getByText('Your unsubmitted draft was kept', { exact: true })).toBeVisible()
  await expect(modal.getByText(/An answer was already saved/)).toBeVisible()
  await expect(modal.getByText(/Version [AB] · Previous take/)).toBeVisible()
  await expect(modal.getByText(/Version [AB] · Repeated take/)).toBeVisible()
  const savedPlayer = await b.elementHandle()
  await modal.getByRole('button', { name: 'Close comparison', exact: true }).click()
  expect(await savedPlayer!.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  await expect(open).toBeFocused()
  await page.reload()
  await open.click()
  await expect(modal.getByText('Your first answer: I hear no clear difference', { exact: true })).toBeVisible()
  await expect(modal.getByLabel('Comparison version A')).toHaveAttribute('src', aUrl!)
  expect((await (await page.request.get('/api/v1/me')).json()).progress).toEqual(progress)
  expect(writes).toBe(2)
  await noOverflow(page)
})
