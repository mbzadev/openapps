/// <reference path="../../workers/jobs/src/worker-configuration.d.ts" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, createExecutionContext, createMessageBatch, getQueueResult, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { handleBatch } from '../../workers/jobs/src/index.js'
import type { JobMessage } from '../../packages/core/src/messages.js'

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] }

beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS))

describe('at-least-once Queue delivery', () => {
  it('deduplicates repeated task ids before side effects', async () => {
    const message: JobMessage = { v: 1, kind: 'dead-letter', original: { source: 'test' }, error: 'expected', failedAt: new Date().toISOString(), taskId: 'duplicate-task' }
    const batch = createMessageBatch('openapps-reconcile', [
      { id: 'delivery-1', timestamp: new Date(), body: message, attempts: 1 },
      { id: 'delivery-2', timestamp: new Date(), body: message, attempts: 1 },
    ])
    const ctx = createExecutionContext()

    await handleBatch(batch, testEnv)
    const result = await getQueueResult(batch, ctx)
    expect(result.explicitAcks).toHaveLength(2)
    expect((await testEnv.DB.prepare("SELECT status,attempt_count FROM sync_tasks WHERE task_id='duplicate-task'").first())).toEqual({ status: 'completed', attempt_count: 1 })
    expect((await testEnv.ARTIFACTS.list({ prefix: 'dlq/' })).objects).toHaveLength(1)
  })

  it('reclaims retries and archives the final DLQ delivery', async () => {
    const message: JobMessage = { v: 1, kind: 'app.sync', platform: 'ios', appId: 999_999, source: 'scheduled', taskId: 'retry-task' }
    for (const attempts of [1, 2]) {
      const batch = createMessageBatch('openapps-sync-tracked-ios', [{ id: `retry-${attempts}`, timestamp: new Date(), body: message, attempts }])
      const ctx = createExecutionContext()
      await handleBatch(batch, testEnv)
      const result = await getQueueResult(batch, ctx)
      expect(result.retryMessages).toHaveLength(1)
    }
    expect((await testEnv.DB.prepare("SELECT status,attempt_count FROM sync_tasks WHERE task_id='retry-task'").first())).toEqual({ status: 'pending', attempt_count: 2 })

    const dlq = createMessageBatch('openapps-dead-letter', [{ id: 'dead', timestamp: new Date(), body: message, attempts: 6 }])
    const ctx = createExecutionContext()
    await handleBatch(dlq, testEnv)
    expect((await getQueueResult(dlq, ctx)).explicitAcks).toEqual(['dead'])
    expect((await testEnv.DB.prepare("SELECT status,failure_reason FROM sync_tasks WHERE task_id='retry-task'").first())).toEqual({ status: 'failed', failure_reason: 'dead_letter' })
    expect((await testEnv.ARTIFACTS.list({ prefix: 'dlq/' })).objects.length).toBeGreaterThanOrEqual(1)
  })
})
