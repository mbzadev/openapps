export function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  data: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...data })
  if (level === 'error') console.error(payload)
  else if (level === 'warn') console.warn(payload)
  else console.log(payload)
}
