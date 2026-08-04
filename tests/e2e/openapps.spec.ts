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
    const registrationResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/register') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create account' }).click()
    const browserToken = (await (await registrationResponse).json() as { token: string }).token
    await context.setExtraHTTPHeaders({ Authorization: `Bearer ${browserToken}` })
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

    let externalId = process.env.OPENAPPS_E2E_EXTERNAL_ID
    if (!externalId) {
      const search = await api.get('/api/v1/apps/search?term=Instagram&platform=ios&country_code=us&limit=1')
      expect(search.status()).toBe(200)
      const results = await search.json() as Array<{ external_id: string }>
      expect(results.length).toBeGreaterThan(0)
      externalId = results[0]!.external_id
    }
    const expectedAppName = process.env.OPENAPPS_E2E_APP_NAME ?? 'Instagram'

    expect((await api.post(`/api/v1/apps/ios/${externalId}/track`, { data: {} })).status()).toBe(204)
    expect((await api.post(`/api/v1/apps/ios/${externalId}/sync`, { data: {} })).status()).toBe(200)
    expect((await api.get(`/api/v1/apps/ios/${externalId}/rankings`)).status()).toBe(200)
    expect((await api.get(`/api/v1/apps/ios/${externalId}/ratings/history`)).status()).toBe(200)
    expect((await api.get('/api/v1/changes/apps')).status()).toBe(200)

    await page.goto('/apps')
    await expect(page.getByText(expectedAppName, { exact: false }).first()).toBeVisible()
    await page.goto('/competitors')
    await expect(page).toHaveURL(/\/competitors/)

    await page.goto('/creatives')
    await expect(page.getByRole('heading', { name: 'Ad Creative Library' })).toBeVisible()
    await page.getByLabel('Source').selectOption('meta')
    await page.getByLabel('Format').selectOption('video')
    await expect(page.getByPlaceholder('Search ads or advertisers')).toBeVisible()
    expect((await api.get('/api/v1/creatives?source=meta&format=video')).status()).toBe(200)

    await page.goto(`/apps/ios/${externalId}?tab=creatives`)
    await expect(page.getByPlaceholder('Search ads or advertisers')).toBeVisible()
    const appCreativeResponse = await api.get(`/api/v1/apps/ios/${externalId}/creatives`)
    expect(appCreativeResponse.status()).toBe(200)
    const refresh = await api.post(`/api/v1/apps/ios/${externalId}/creatives/sync`, { data: {} })
    expect([202, 503]).toContain(refresh.status())

    const cleanup = await api.delete('/api/v1/account/profile', { data: { password } })
    expect(cleanup.status()).toBe(204)
    registered = false
  } finally {
    if (registered) await api.delete('/api/v1/account/profile', { data: { password } }).catch(() => undefined)
  }
})
