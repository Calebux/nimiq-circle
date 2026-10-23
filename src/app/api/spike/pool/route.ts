import { errorResponse } from '@/lib/errors'
import { getPoolStatus } from '@/lib/nimiq/pool'

export async function GET() {
  try {
    return Response.json(await getPoolStatus())
  } catch (err) {
    return errorResponse(err)
  }
}
