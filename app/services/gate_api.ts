import 'dotenv/config'
import { ApiClient, FuturesApi } from 'gate-api'

// Gate.io API configuration using environment variables
const config = {
  apiKey: process.env.GATE_TESTNET_API_KEY || process.env.GATE_API_KEY || '',
  apiSecret: process.env.GATE_TESTNET_API_SECRET || process.env.GATE_API_SECRET || '',
  basePath: 'https://api-testnet.gateapi.io/api/v4'
}

const client = new ApiClient()
client.basePath = config.basePath
client.setApiKeySecret(config.apiKey, config.apiSecret)

const futuresApi = new FuturesApi(client)

// ============ Rate Limiting & Retry Logic ============
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 10000

// Sleep utility for retry delays
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Exponential backoff with jitter
function calculateDelay(retryCount: number): number {
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, retryCount)
  const jitter = Math.random() * 500 // Add 0-500ms jitter to prevent thundering herd
  return Math.min(exponentialDelay + jitter, MAX_DELAY_MS)
}

// Check if error is rate limit related (HTTP 429)
function isRateLimitError(error: any): boolean {
  return error.response?.status === 429 ||
         error.response?.body?.message?.includes('429') ||
         error.response?.body?.message?.includes('rate limit')
}

// Check if error is retryable (network error, timeout, 5xx)
function isRetryableError(error: any): boolean {
  if (isRateLimitError(error)) return true
  if (!error.response) return true // Network error
  if (error.response.status >= 500) return true // Server error
  return false
}

// Wrapper function with automatic retry
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string = 'API operation',
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error

      if (!isRetryableError(error) || attempt === maxRetries) {
        // Not retryable or max retries reached
        const errorMsg = error.response?.body?.message || error.message || 'Unknown error'
        console.error(`[API Error] ${operationName} failed after ${attempt + 1} attempts: ${errorMsg}`)
        throw error
      }

      const delay = calculateDelay(attempt)
      const isRateLimit = isRateLimitError(error)
      console.warn(
        `[API Retry] ${operationName} - Attempt ${attempt + 1}/${maxRetries} failed` +
        (isRateLimit ? ' (Rate Limited)' : '') +
        `, retrying in ${Math.round(delay)}ms...`
      )
      await sleep(delay)
    }
  }

  throw lastError
}

export interface Position {
  symbol: string
  side: 'long' | 'short'
  amount: number
  entry_price: number
  current_price: number
  pnl: number
  leverage: number
  updated_at: string
}

export interface Balance {
  total: number
  available: number
  unrealisedPnl: number
}

export interface GateApiResult {
  positions: Position[]
  balance: Balance | null
  error?: string
}

export async function fetchPositionsAndBalance(): Promise<GateApiResult> {
  try {
    // Get positions with retry
    const positionsResult = await withRetry(
      () => futuresApi.listPositions('usdt'),
      'listPositions'
    )
    const posList = Array.isArray(positionsResult.body) ? positionsResult.body : []

    const positions: Position[] = posList
      .filter((p: any) => parseFloat(String(p.size)) !== 0)
      .map((p: any) => ({
        symbol: String(p.contract),
        side: parseFloat(String(p.size)) > 0 ? 'long' : 'short',
        amount: Math.abs(parseFloat(String(p.size))),
        entry_price: parseFloat(String(p.entryPrice)),
        current_price: parseFloat(String(p.markPrice)),
        pnl: parseFloat(String(p.unrealisedPnl)),
        leverage: p.leverage || 20,
        updated_at: new Date().toISOString()
      }))

    // Get balance with retry
    const accounts = await withRetry(
      () => futuresApi.listFuturesAccounts('usdt'),
      'listFuturesAccounts'
    )
    const balance: Balance = {
      total: parseFloat(String(accounts.body.total || '0')),
      available: parseFloat(String(accounts.body.available || '0')),
      unrealisedPnl: parseFloat(String(accounts.body.unrealisedPnl || '0'))
    }

    return { positions, balance }
  } catch (e: any) {
    const errorMsg = e.response?.body?.message || e.message || '获取持仓失败'
    console.error('Gate.io API 错误:', errorMsg)
    return {
      positions: [],
      balance: null,
      error: errorMsg
    }
  }
}

export { futuresApi, withRetry }
