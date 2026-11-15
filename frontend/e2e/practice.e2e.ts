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
