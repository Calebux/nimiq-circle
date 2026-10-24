import { errorResponse } from '@/lib/errors'
import { getPoolStatus } from '@/lib/nimiq/pool'
import { requireSpike } from '@/lib/security'

export async function GET() {
  try {
    requireSpike()
    return Response.json(await getPoolStatus())
  } catch (err) {
    return errorResponse(err)
  }
}
