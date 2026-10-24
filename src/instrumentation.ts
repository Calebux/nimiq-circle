/** Runs once when the server starts: kick off the background worker (Node runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorker } = await import('./lib/worker')
    startWorker()
  }
}
