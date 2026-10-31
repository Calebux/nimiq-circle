import { errorResponse } from '@/lib/errors'
import { publicStats } from '@/lib/stats'

/** Public, no sign-in: how much real saving happens on Akilii. */
export async function GET() {
  try {
    return Response.json(await publicStats())
  } catch (err) {
    return errorResponse(err)
  }
}
