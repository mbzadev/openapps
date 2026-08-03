import { expect, test } from '@playwright/test'

test('account, token, folder, discovery, tracking, analytics and cleanup journey', async ({ page, context }) => {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const email = `playwright-${nonce}@example.invalid`
  const password = `Playwright-${nonce}!`
  const api = context.request
  let registered = false

  try {
    await page.goto('/register')
    await page.getByLabel('Name').fill('Playwright User')
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password').fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/discovery\/trending/)
    registered = true

  await page.goto('/settings')
  await page.getByLabel('Name', { exact: true }).fill('Playwright Updated')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Profile updated.')).toBeVisible()

  await page.goto('/settings/api-tokens')
  await page.getByLabel('Token Name').fill('Playwright MCP')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Token Created' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Playwright MCP')).toBeVisible()

    const folder = await api.post('/api/v1/folders', { data: { name: 'Playwright Folder', color: 'emerald' } })
    expect(folder.status()).toBe(201)

    const search = await api.get('/api/v1/apps/search?term=Instagram&platform=ios&country_code=us&limit=1')
    expect(search.status()).toBe(200)
    const results = await search.json() as Array<{ external_id: string }>
    expect(results.length).toBeGreaterThan(0)
    const externalId = results[0]!.external_id

    expect((await api.post(`/api/v1/apps/ios/${externalId}/track`, { data: {} })).status()).toBe(204)
    expect((await api.post(`/api/v1/apps/ios/${externalId}/sync`, { data: {} })).status()).toBe(200)
    expect((await api.get(`/api/v1/apps/ios/${externalId}/rankings`)).status()).toBe(200)
    expect((await api.get(`/api/v1/apps/ios/${externalId}/ratings/history`)).status()).toBe(200)
    expect((await api.get('/api/v1/changes/apps')).status()).toBe(200)

    await page.goto('/apps')
    await expect(page.getByText('Instagram', { exact: false }).first()).toBeVisible()
    await page.goto('/competitors')
    await expect(page).toHaveURL(/\/competitors/)

    const cleanup = await api.delete('/api/v1/account/profile', { data: { password } })
    expect(cleanup.status()).toBe(204)
    registered = false
  } finally {
    if (registered) await api.delete('/api/v1/account/profile', { data: { password } }).catch(() => undefined)
  }
})
