import 'server-only'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { serverConfig } from '@/lib/env'
import { getBalance, getBlockNumber, getPolicy, getStaker, type ChainStaker } from './rpc'

export const SPIKE_LOG = path.join(process.cwd(), 'data', 'spike-log.jsonl')

export interface SpikeLogEntry {
  at: string
  block: number
  event: string
  detail?: Record<string, unknown>
}

export interface BlockEta {
  block: number
  /** Seconds from now, assuming one block per blockSeparationTime. 0 once reached. */
  inSeconds: number
}

export interface PoolStatus {
  address: string
  network: string
  validator: string | null
  block: number
  /** Liquid luna, i.e. what can be paid out right now. */
  liquid: number
  staker: ChainStaker | null
  minimumStake: number
  epochSeconds: number
  nextElection: BlockEta
  /** When the current inactive balance can be retired (and then removed immediately). */
  inactiveRelease: BlockEta | null
  log: SpikeLogEntry[]
}

export async function appendLog(event: string, block: number, detail?: Record<string, unknown>) {
  const entry: SpikeLogEntry = { at: new Date().toISOString(), block, event, detail }
  await mkdir(path.dirname(SPIKE_LOG), { recursive: true })
  await appendFile(SPIKE_LOG, JSON.stringify(entry) + '\n')
}

async function readLog(): Promise<SpikeLogEntry[]> {
  try {
    const text = await readFile(SPIKE_LOG, 'utf8')
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SpikeLogEntry)
  } catch {
    return []
  }
}

export async function getPoolStatus(): Promise<PoolStatus> {
  const { nim } = serverConfig()
  if (!nim.poolAddress) throw new Error('POOL_ADDRESS is not configured')

  const [block, policy, liquid, staker, log] = await Promise.all([
    getBlockNumber(),
    getPolicy(),
    getBalance(nim.poolAddress),
    getStaker(nim.poolAddress),
    readLog(),
  ])
  const blockSeconds = policy.blockSeparationTime / 1000
  const eta = (target: number): BlockEta => ({ block: target, inSeconds: Math.max(0, (target - block) * blockSeconds) })
  // Election blocks sit on multiples of blocksPerEpoch (genesis is one too).
  const nextElection = Math.ceil((block + 1) / policy.blocksPerEpoch) * policy.blocksPerEpoch

  return {
    address: nim.poolAddress,
    network: nim.network,
    validator: staker?.delegation ?? nim.validator,
    block,
    liquid,
    staker,
    minimumStake: policy.minimumStake,
    epochSeconds: policy.blocksPerEpoch * blockSeconds,
    nextElection: eta(nextElection),
    inactiveRelease: staker?.inactiveBalance && staker.inactiveRelease ? eta(staker.inactiveRelease) : null,
    log: log.slice(-20).reverse(),
  }
}
