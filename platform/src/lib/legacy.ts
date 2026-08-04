import { getCloudflareContext } from '@opennextjs/cloudflare'
import legacyWorker from '@openapps/web-worker'

export async function delegateLegacyRequest(request: Request): Promise<Response> {
  const { env, ctx } = await getCloudflareContext({ async: true })
  try {
    return await legacyWorker.fetch(
      request,
      env as Parameters<typeof legacyWorker.fetch>[1],
      ctx as Parameters<typeof legacyWorker.fetch>[2],
    )
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'legacy.request.failed',
      method: request.method,
      path: new URL(request.url).pathname,
      message: error instanceof Error ? error.message : String(error),
    }))
    return Response.json({ message: 'Internal Server Error' }, { status: 500 })
  }
}
