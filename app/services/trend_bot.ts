import { getDb, all, get, run } from './database.js'
import { fetchPositionsAndBalance, futuresApi } from './gate_api.js'

async function getMarketPrice(): Promise<number> {
  try {
    const url = 'https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1m&limit=1'
    const response = await fetch(url)
    const data = await response.json()
    if (Array.isArray(data) && data.length > 0) {
      return parseFloat(data[0].c)
    }
    return 0
  } catch (e: any) {
    log(`[TrendBot] 获取市场价格失败: ${e.message}`)
    return 0
  }
}

// ============ Strategy Identity ============
const MY_STRATEGY = 'trend'

// ============ Configuration ============
interface TradingSettings {
  leverage: number
}

interface Config {
  symbol: string
  maxLeverage: number
  rsiOversold: number
  rsiOverbought: number
  rsiPeriod: number
  trendFilter: boolean
  volumeConfirm: boolean
  trailingStop: boolean
  takeProfitPercent: number
  stopLossPercent: number
  baseTradeAmount: number
  cooldownMinutes: number
  checkIntervalWithPosition: number
  checkIntervalWithoutPosition: number
  dcaEnabled: boolean
  dcaMaxPositions: number
  dcaAddPercent: number
  dcaAddAmount: number
  dcaCooldownMinutes: number
  dcaReduceOnTP: boolean
  // Trailing stop config
  initialTP: number
  trailingPercent: number
  minTrailingTP: number
  maxTrailingTP: number
  // Dynamic position sizing config
  basePercent: number
  maxPercent: number
  minPercent: number
  signalStrong: number
  signalWeak: number
  strongMultiplier: number
  weakMultiplier: number
  // Multi-strategy mode config
  strategyMode: 'trend' | 'grid' | 'arbitrage' | 'smart'
  strongTrendThreshold: number
  weakTrendThreshold: number
  // Internally managed
  leverage: number
}

const CONFIG: Config = {
  symbol: 'BTC_USDT',
  maxLeverage: 10,
  rsiOversold: 35,
  rsiOverbought: 70,
  rsiPeriod: 14,
  trendFilter: true,
  volumeConfirm: true,
  trailingStop: false,
  takeProfitPercent: 3,
  stopLossPercent: 2,
  baseTradeAmount: 0.01,
  cooldownMinutes: 5,
  checkIntervalWithPosition: 30000,
  checkIntervalWithoutPosition: 300000,
  dcaEnabled: true,
  dcaMaxPositions: 3,
  dcaAddPercent: -2,
  dcaAddAmount: 5,
  dcaCooldownMinutes: 30,
  dcaReduceOnTP: false,
  initialTP: 3,
  trailingPercent: 1,
  minTrailingTP: 2,
  maxTrailingTP: 5,
  basePercent: 10,
  maxPercent: 20,
  minPercent: 5,
  signalStrong: 5,
  signalWeak: 2,
  strongMultiplier: 1.5,
  weakMultiplier: 0.5,
  strategyMode: 'trend',
  strongTrendThreshold: 5,
  weakTrendThreshold: 2,
  leverage: 10,
}

// ============ Database Initialization ============
export function initializeDatabase() {
  const db = getDb()

  // Create trades table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      side TEXT NOT NULL,
      amount REAL NOT NULL,
      price REAL NOT NULL,
      strategy TEXT,
      reason TEXT,
      pnl REAL DEFAULT 0
    )
  `)

  // Create check_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS check_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      price REAL,
      position_size REAL,
      position_entry_price REAL,
      balance_total REAL,
      balance_available REAL,
      rsi REAL,
      ma10 REAL,
      ma20 REAL,
      ma50 REAL,
      macd_hist REAL,
      trend TEXT,
      volume_ok INTEGER,
      signal_buy INTEGER,
      signal_sell INTEGER,
      signal_strength INTEGER,
      signal_reason TEXT,
      action TEXT,
      action_amount REAL,
      action_price REAL,
      pnl_percent REAL,
      bollinger_b REAL,
      stoch_k REAL,
      stoch_d REAL,
      atr REAL,
      adx REAL,
      plus_di REAL,
      minus_di REAL
    )
  `)

  // Migration: Add new columns to existing check_logs table
  const migrationColumns = [
    { name: 'bollinger_b', type: 'REAL' },
    { name: 'stoch_k', type: 'REAL' },
    { name: 'stoch_d', type: 'REAL' },
    { name: 'atr', type: 'REAL' },
    { name: 'adx', type: 'REAL' },
    { name: 'plus_di', type: 'REAL' },
    { name: 'minus_di', type: 'REAL' },
  ]

  for (const col of migrationColumns) {
    try {
      db.exec(`ALTER TABLE check_logs ADD COLUMN ${col.name} ${col.type}`)
    } catch {
      // Column may already exist
    }
  }

  // Create debug_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS debug_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT
    )
  `)

  // Create heartbeat table
  db.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      bot_name TEXT NOT NULL DEFAULT 'trend-bot',
      status TEXT NOT NULL DEFAULT 'alive',
      price REAL,
      position_size REAL,
      balance_total REAL,
      balance_available REAL,
      pnl_percent REAL
    )
  `)

  // Create settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      leverage INTEGER NOT NULL DEFAULT 10,
      active_strategy TEXT NOT NULL DEFAULT 'trend',
      updated_at TEXT NOT NULL
    )
  `)

  // Add active_strategy column if it doesn't exist (for existing databases)
  try {
    db.exec("ALTER TABLE settings ADD COLUMN active_strategy TEXT NOT NULL DEFAULT 'trend'")
  } catch {
    // Column may already exist
  }

  // Initialize settings row if not exists
  const settingsRow = db.prepare('SELECT leverage FROM settings WHERE id = 1').get()
  if (!settingsRow) {
    db.prepare('INSERT INTO settings (id, leverage, active_strategy, updated_at) VALUES (1, 10, ?, ?)').run('trend', new Date().toISOString())
  }

  console.log('[TrendBot] Database initialized')
}

// ============ Strategy Check ============
function isActiveStrategy(): boolean {
  try {
    const row = getDb().prepare('SELECT active_strategy FROM settings WHERE id = 1').get() as any
    return row?.active_strategy === MY_STRATEGY
  } catch {
    return true // Default to active if no settings
  }
}

// ============ Settings Management ============
function loadTradingSettings(): TradingSettings {
  try {
    const row = getDb().prepare('SELECT leverage FROM settings WHERE id = 1').get() as { leverage: number } | undefined
    let leverage = row?.leverage || 10
    if (leverage > CONFIG.maxLeverage) {
      console.log(`⚠️ 杠杆 ${leverage}x 超过安全限制 ${CONFIG.maxLeverage}x，已调整为 ${CONFIG.maxLeverage}x`)
      leverage = CONFIG.maxLeverage
    }
    if (leverage < 1) leverage = 1
    return { leverage }
  } catch {
    return { leverage: 10 }
  }
}

// ============ Logging Functions ============
function debugLog(level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', category: string, message: string, details: any = null) {
  try {
    const stmt = getDb().prepare(`
      INSERT INTO debug_logs (timestamp, level, category, message, details)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(
      new Date().toISOString(),
      level,
      category,
      message,
      details ? JSON.stringify(details) : null
    )
  } catch (e: any) {
    console.error('写入调试日志失败:', e.message)
  }

  const colors: Record<string, string> = {
    'INFO': '\x1b[36m',
    'WARN': '\x1b[33m',
    'ERROR': '\x1b[31m',
    'SUCCESS': '\x1b[32m',
  }
  const reset = '\x1b[0m'
  console.log(`${colors[level] || ''}[${level}]${reset} [${category}] ${message}`)
}

function log(message: string) {
  console.log(message)
}

// ============ Heartbeat Functions ============
function writeHeartbeat(status: 'alive' | 'offline' = 'alive') {
  try {
    const position = cachedPosition
    const balance = cachedBalance

    const stmt = getDb().prepare(`
      INSERT INTO heartbeat (timestamp, bot_name, status, price, position_size, balance_total, balance_available, pnl_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      new Date().toISOString(),
      'trend-bot',
      status,
      position?.markPrice || null,
      position?.size || null,
      balance?.total || null,
      balance?.available || null,
      position && position.entryPrice && position.markPrice
        ? ((position.markPrice - position.entryPrice) / position.entryPrice * 100)
        : null
    )
  } catch (e: any) {
    console.error('写入心跳失败:', e.message)
  }
}


// ============ Cached State ============
let cachedPosition: any = null
let cachedBalance: any = null

// DCA State
let dcaPositionCount = 0
let dcaAvgEntryPrice = 0
let lastAddPositionTime = 0

// Trailing Stop State
let trailingActive = false
let highestPrice = 0
let trailingTP = 0

// Signal history
const signalHistory = {
  lastTradeTime: 0,
}

// ============ API Functions ============
async function getPosition() {
  try {
    const result = await fetchPositionsAndBalance()
    if (result.error) {
      debugLog('ERROR', 'API', `获取持仓失败: ${result.error}`)
      return null
    }
    cachedBalance = result.balance
    if (result.positions.length > 0) {
      cachedPosition = result.positions[0]
      return cachedPosition
    }
    cachedPosition = null
    return null
  } catch (e: any) {
    debugLog('ERROR', 'API', `获取持仓错误: ${e.message}`)
    return null
  }
}

async function getFuturesBalance() {
  try {
    const result = await fetchPositionsAndBalance()
    if (result.error) {
      debugLog('ERROR', 'API', `获取余额失败: ${result.error}`)
      return null
    }
    cachedBalance = result.balance
    return result.balance
  } catch (e: any) {
    debugLog('ERROR', 'API', `获取余额错误: ${e.message}`)
    return null
  }
}

async function openLong(price: number, size: number): Promise<boolean> {
  try {
    const settings = loadTradingSettings()
    const order = {
      contract: CONFIG.symbol,
      type: 'buy',
      price: String(price),
      size: String(Math.abs(size)),
      leverage: String(settings.leverage),
    }
    
    const result = await futuresApi.createFuturesOrder(order)
    debugLog('SUCCESS', 'TRADE', `开多成功: ${size} @ ${price}`, result.body)
    return true
  } catch (e: any) {
    const msg = e.response?.body?.message || e.message
    debugLog('ERROR', 'TRADE', `开多失败: ${msg}`)
    return false
  }
}

async function closeLong(price: number, size: number): Promise<boolean> {
  try {
    const order = {
      contract: CONFIG.symbol,
      type: 'sell',
      price: String(price),
      size: String(Math.abs(size)),
    }
    
    const result = await futuresApi.createFuturesOrder(order)
    debugLog('SUCCESS', 'TRADE', `平多成功: ${size} @ ${price}`, result.body)
    return true
  } catch (e: any) {
    const msg = e.response?.body?.message || e.message
    debugLog('ERROR', 'TRADE', `平多失败: ${msg}`)
    return false
  }
}

async function getCandlesticks(interval: string = '15m', limit: number = 100) {
  try {
    const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=${interval}&limit=${limit}`
    
    const response = await fetch(url)
    const data = await response.json()
    
    if (Array.isArray(data)) {
      return data.map((k: any) => ({
        time: k.t,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
      }))
    }
    return []
  } catch (e: any) {
    debugLog('ERROR', 'API', `获取K线失败: ${e.message}`)
    return []
  }
}

// ============ Technical Indicators ============
function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50

  let gains = 0
  let losses = 0

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1]
    if (change > 0) gains += change
    else losses -= change
  }

  const avgGain = gains / period
  const avgLoss = losses / period

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0

  const multiplier = 2 / (period + 1)
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema
  }

  return ema
}

function calculateMACD(prices: number[]) {
  const ema12 = calculateEMA(prices, 12)
  const ema26 = calculateEMA(prices, 26)
  const macd = ema12 - ema26
  const signal = calculateEMA([...Array(9)].map((_, i) => macd), 9)
  const histogram = macd - signal
  return { macd, signal, histogram }
}

// ============ Additional Technical Indicators ============

// Bollinger Bands - volatility indicator
// Returns { upper, middle, lower, bandwidth, percentB }
function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
  upper: number
  middle: number
  lower: number
  bandwidth: number
  percentB: number
} {
  if (prices.length < period) {
    return { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5 }
  }

  const slice = prices.slice(-period)
  const middle = slice.reduce((a, b) => a + b, 0) / period

  // Calculate standard deviation
  const squaredDiffs = slice.map(p => Math.pow(p - middle, 2))
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period
  const sd = Math.sqrt(variance)

  const upper = middle + (stdDev * sd)
  const lower = middle - (stdDev * sd)
  const bandwidth = ((upper - lower) / middle) * 100
  const currentPrice = prices[prices.length - 1]
  const percentB = (currentPrice - lower) / (upper - lower)

  return { upper, middle, lower, bandwidth, percentB }
}

// Stochastic Oscillator - momentum indicator
// Returns { k, d } where K is %K and D is %D (SMA of %K)
function calculateStochastic(candles: { high: number; low: number; close: number }[], period: number = 14): {
  k: number
  d: number
} {
  if (candles.length < period) return { k: 50, d: 50 }

  const slice = candles.slice(-period)
  const highestHigh = Math.max(...slice.map(c => c.high))
  const lowestLow = Math.min(...slice.map(c => c.low))
  const currentClose = candles[candles.length - 1].close

  if (highestHigh === lowestLow) return { k: 50, d: 50 }

  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100

  // Calculate %D as SMA of %K over 3 periods
  if (candles.length < period + 2) return { k, d: k }

  // Simple approximation: use current K as D if not enough data
  const d = k

  return { k, d }
}

// Average True Range - volatility measure
function calculateATR(candles: { high: number; low: number; close: number }[], period: number = 14): number {
  if (candles.length < period + 1) return 0

  const trueRanges: number[] = []

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high
    const low = candles[i].low
    const prevClose = candles[i - 1].close

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    trueRanges.push(tr)
  }

  if (trueRanges.length < period) return 0

  const slice = trueRanges.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

// ADX - Average Directional Index (trend strength)
function calculateADX(candles: { high: number; low: number; close: number }[], period: number = 14): {
  adx: number
  plusDI: number
  minusDI: number
} {
  if (candles.length < period + 1) return { adx: 0, plusDI: 0, minusDI: 0 }

  const highValues = candles.map(c => c.high)
  const lowValues = candles.map(c => c.low)
  const closeValues = candles.map(c => c.close)

  // Calculate +DM and -DM
  const plusDM: number[] = []
  const minusDM: number[] = []
  const trueRanges: number[] = []

  for (let i = 1; i < candles.length; i++) {
    const highDiff = highValues[i] - highValues[i - 1]
    const lowDiff = lowValues[i - 1] - lowValues[i]

    const tr = Math.max(
      highValues[i] - lowValues[i],
      Math.abs(highValues[i] - closeValues[i - 1]),
      Math.abs(lowValues[i] - closeValues[i - 1])
    )
    trueRanges.push(tr)

    // +DM: only when highDiff > lowDiff and highDiff > 0
    if (highDiff > lowDiff && highDiff > 0) {
      plusDM.push(highDiff)
    } else {
      plusDM.push(0)
    }

    // -DM: only when lowDiff > highDiff and lowDiff > 0
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDM.push(lowDiff)
    } else {
      minusDM.push(0)
    }
  }

  // Smooth using EMA
  const smoothedTR = calculateEMA(trueRanges, period)
  const smoothedPlusDM = calculateEMA(plusDM, period)
  const smoothedMinusDM = calculateEMA(minusDM, period)

  if (smoothedTR === 0) return { adx: 0, plusDI: 0, minusDI: 0 }

  const plusDI = (smoothedPlusDM / smoothedTR) * 100
  const minusDI = (smoothedMinusDM / smoothedTR) * 100

  // Calculate DX
  const diSum = plusDI + minusDI
  if (diSum === 0) return { adx: 0, plusDI, minusDI }

  const dx = (Math.abs(plusDI - minusDI) / diSum) * 100

  // ADX is EMA of DX
  const adx = dx // Simplified - full implementation would smooth DX over 14 periods

  return { adx, plusDI, minusDI }
}

// ============ Signal Detection ============
interface Signals {
  buy: boolean
  sell: boolean
  rsi: number
  ma10: number
  ma20: number
  ma50: number
  macdHist: number
  trendUp: boolean
  volumeOK: boolean
  strength: number
  reason: string[]
  // New indicators
  bollingerB: number  // Bollinger Bands %B (0-1, <0.2 oversold, >0.8 overbought)
  stochK: number      // Stochastic %K
  stochD: number      // Stochastic %D
  atr: number         // Average True Range
  adx: number         // Average Directional Index
  plusDI: number      // ADX +DI
  minusDI: number     // ADX -DI
}

async function detectSignals(): Promise<Signals> {
  const candles = await getCandlesticks('15m', 100)
  if (candles.length < 50) {
    return {
      buy: false,
      sell: false,
      rsi: 50,
      ma10: 0,
      ma20: 0,
      ma50: 0,
      macdHist: 0,
      trendUp: true,
      volumeOK: true,
      strength: 0,
      reason: ['K线数据不足'],
      bollingerB: 0.5,
      stochK: 50,
      stochD: 50,
      atr: 0,
      adx: 0,
      plusDI: 0,
      minusDI: 0,
    }
  }

  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)

  const rsi = calculateRSI(closes, CONFIG.rsiPeriod)
  const ma10 = calculateEMA(closes.slice(-10), 10)
  const ma20 = calculateEMA(closes.slice(-20), 20)
  const ma50 = calculateEMA(closes.slice(-50), 50)
  const { histogram: macdHist } = calculateMACD(closes)

  // Calculate new indicators
  const { percentB: bollingerB } = calculateBollingerBands(closes, 20, 2)
  const { k: stochK, d: stochD } = calculateStochastic(candles, 14)
  const atr = calculateATR(candles, 14)
  const { adx, plusDI, minusDI } = calculateADX(candles, 14)

  const currentPrice = closes[closes.length - 1]
  const trendUp = ma10 > ma20 && ma20 > ma50
  const volumeAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
  const volumeOK = volumes[volumes.length - 1] > volumeAvg * 0.8

  // ADX trend strength interpretation
  const strongTrend = adx > 25
  const trendDirection = plusDI > minusDI ? 'long' : 'short'

  const signals = {
    buy: false,
    sell: false,
    rsi,
    ma10,
    ma20,
    ma50,
    macdHist,
    trendUp,
    volumeOK,
    strength: 0,
    reason: [] as string[],
    // New indicators
    bollingerB,
    stochK,
    stochD,
    atr,
    adx,
    plusDI,
    minusDI,
  }

  // Buy signal conditions
  if (rsi < CONFIG.rsiOversold) {
    signals.reason.push(`RSI超卖(${rsi.toFixed(1)}<${CONFIG.rsiOversold})`)
    signals.strength += 1
  }

  if (trendUp && CONFIG.trendFilter) {
    signals.reason.push('趋势向上(MA多头)')
    signals.strength += 1
  }

  if (macdHist > 0) {
    signals.reason.push('MACD柱为正')
    signals.strength += 1
  }

  // New indicator signals
  if (bollingerB < 0.2) {
    signals.reason.push(`布林带超卖(${bollingerB.toFixed(2)}<0.2)`)
    signals.strength += 1
  }

  if (stochK < 20 && stochD < 20) {
    signals.reason.push('随机指超卖')
    signals.strength += 1
  }

  // ADX confirms trend strength
  if (strongTrend && trendDirection === 'long') {
    signals.reason.push(`ADX确认上涨趋势(adx=${adx.toFixed(1)})`)
    signals.strength += 1
  }

  // Final buy/sell determination
  signals.buy = signals.strength >= 3 && rsi < CONFIG.rsiOversold && trendUp

  // Sell signal
  if (rsi > CONFIG.rsiOverbought) {
    signals.sell = true
    signals.reason.push(`RSI超买(${rsi.toFixed(1)}>${CONFIG.rsiOverbought})`)
  }

  if (macdHist < 0 && signals.strength < 2) {
    signals.sell = true
    signals.reason.push('MACD柱为负')
  }

  // New sell signals
  if (bollingerB > 0.8) {
    signals.sell = true
    signals.reason.push(`布林带超买(${bollingerB.toFixed(2)}>0.8)`)
  }

  if (stochK > 80 && stochD > 80) {
    signals.sell = true
    signals.reason.push('随机指超买')
  }

  // ADX confirms strong downtrend
  if (strongTrend && trendDirection === 'short') {
    signals.sell = true
    signals.reason.push(`ADX确认下跌趋势(adx=${adx.toFixed(1)})`)
  }

  return signals
}

// ============ Trade Functions ============
function updateDCAState(newSize: number, newPrice: number) {
  if (dcaPositionCount === 0) {
    dcaAvgEntryPrice = newPrice
    dcaPositionCount = 1
  } else {
    const totalCost = dcaAvgEntryPrice * dcaPositionCount + newPrice * newSize
    const totalSize = dcaPositionCount + newSize
    dcaAvgEntryPrice = totalCost / totalSize
    dcaPositionCount += 1
  }
  log(`[TrendBot] DCA状态更新: 批次=${dcaPositionCount}, 均价=$${dcaAvgEntryPrice.toLocaleString()}`)
}

function resetDCAState() {
  dcaPositionCount = 0
  dcaAvgEntryPrice = 0
  lastAddPositionTime = 0
  log('[TrendBot] DCA状态已重置')
}

function resetTrailingState() {
  trailingActive = false
  highestPrice = 0
  trailingTP = 0
  log('[TrendBot] 追踪止损状态已重置')
}

function recordTrade(type: string, side: string, amount: number, price: number, reason: string, pnl: number = 0) {
  try {
    const stmt = getDb().prepare(`
      INSERT INTO trades (timestamp, symbol, type, side, amount, price, strategy, reason, pnl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      new Date().toISOString(),
      CONFIG.symbol,
      type,
      side,
      amount,
      price,
      'trend-bot',
      reason,
      pnl
    )
    log(`[TrendBot] 交易记录已写入: ${CONFIG.symbol} ${type} ${side} ${amount} @ ${price}`)
  } catch (e: any) {
    log(`[TrendBot] 写入交易记录失败: ${e.message}`)
  }
}

function canTrade(): boolean {
  const cooldownMs = CONFIG.cooldownMinutes * 60 * 1000
  return Date.now() - signalHistory.lastTradeTime >= cooldownMs
}

// ============ Dynamic Position Sizing ============
function calculatePositionPercent(signalStrength: number, balanceAvail: number): number {
  // Determine base percentage based on signal strength
  let percent: number
  if (signalStrength >= CONFIG.signalStrong) {
    percent = CONFIG.basePercent * CONFIG.strongMultiplier
  } else if (signalStrength <= CONFIG.signalWeak) {
    percent = CONFIG.basePercent * CONFIG.weakMultiplier
  } else {
    percent = CONFIG.basePercent
  }

  // Cap at maxPercent and floor at minPercent
  percent = Math.min(percent, CONFIG.maxPercent)
  percent = Math.max(percent, CONFIG.minPercent)

  // If balance < 1000 USDT, use minPercent
  if (balanceAvail < 1000) {
    percent = CONFIG.minPercent
  }

  return percent
}

// ============ Main Trade Cycle ============
let checkInterval = CONFIG.checkIntervalWithoutPosition

async function tradeCycle() {
  // Check if strategy is still active
  if (!isActiveStrategy()) {
    const row = getDb().prepare('SELECT active_strategy FROM settings WHERE id = 1').get() as any
    log(`[TrendBot] 策略已切换到 ${row?.active_strategy || '未知'}，正在停止...`)
    stopTrendBot()
    return
  }

  try {
    const position = await getPosition()
    const balance = await getFuturesBalance()
    let currentPrice = position?.current_price || 0
    if (!currentPrice) {
      currentPrice = await getMarketPrice()
    }

    if (!currentPrice) {
      log('[TrendBot] 无法获取当前价格')
      return
    }

    const signals = await detectSignals()
    log(`[TrendBot] 价格: $${currentPrice}, RSI: ${signals.rsi.toFixed(1)}, BollingerB: ${signals.bollingerB.toFixed(2)}, Stoch: ${signals.stochK.toFixed(1)}/${signals.stochD.toFixed(1)}, ADX: ${signals.adx.toFixed(1)}, 信号: ${signals.buy ? '买入' : signals.sell ? '卖出' : '观望'}`)

    // Calculate PnL
    let pnlPercent = null
    if (position && position.size !== 0 && position.entry_price) {
      pnlPercent = (currentPrice - position.entry_price) / position.entry_price * 100
    }

    // Handle existing position
    if (position && position.size > 0) {
      // Stop loss check
      if (pnlPercent !== null && pnlPercent <= -CONFIG.stopLossPercent) {
        log(`[TrendBot] 触发止损! 亏损${pnlPercent.toFixed(2)}%`)
        if (canTrade()) {
          await closeLong(currentPrice, position.size)
          recordTrade('close', 'long', position.size, currentPrice, `止损(${pnlPercent.toFixed(2)}%)`, pnlPercent)
          signalHistory.lastTradeTime = Date.now()
          resetDCAState()
          resetTrailingState()
        }
        return
      }

      // Take profit check - activate trailing stop when profit reaches initialTP
      if (pnlPercent !== null && pnlPercent >= CONFIG.initialTP && !trailingActive) {
        trailingActive = true
        highestPrice = currentPrice
        trailingTP = currentPrice - (currentPrice * CONFIG.trailingPercent / 100)
        log(`[TrendBot] 激活追踪止损! 盈利${pnlPercent.toFixed(2)}%, 初始追踪价=${trailingTP.toFixed(2)}`)
      }

      // Trailing stop trailing logic
      if (trailingActive) {
        // Update highest price if current price exceeds it
        if (currentPrice > highestPrice) {
          highestPrice = currentPrice
          log(`[TrendBot] 更新最高价: ${highestPrice.toFixed(2)}`)
        }

        // Recalculate trailing TP
        const newTrailingTP = highestPrice - (highestPrice * CONFIG.trailingPercent / 100)

        // Ensure trailingTP never exceeds maxTrailingTP (as percentage drop from highest)
        const maxTPPrice = highestPrice * (1 - CONFIG.maxTrailingTP / 100)
        trailingTP = Math.min(newTrailingTP, maxTPPrice)

        // Check if price has dropped enough to trigger trailing stop
        const priceDropPercent = (highestPrice - currentPrice) / highestPrice
        if (priceDropPercent >= CONFIG.trailingPercent / 100) {
          log(`[TrendBot] 触发追踪止损! 跌幅${(priceDropPercent * 100).toFixed(2)}% >= ${CONFIG.trailingPercent}%, 追踪价=${trailingTP.toFixed(2)}`)
          if (canTrade()) {
            await closeLong(currentPrice, position.size)
            recordTrade('close', 'long', position.size, currentPrice, `追踪止损(跌幅${(priceDropPercent * 100).toFixed(2)}%))`, pnlPercent)
            signalHistory.lastTradeTime = Date.now()
            resetDCAState()
            resetTrailingState()
          }
          return
        }
      }

      // Smart strategy switching (when strategyMode is 'smart')
      if (CONFIG.strategyMode === 'smart') {
        if (signals.strength >= CONFIG.strongTrendThreshold) {
          debugLog('INFO', 'STRATEGY', `智能策略切换: 使用趋势策略 (信号强度${signals.strength} >= ${CONFIG.strongTrendThreshold})`)
        } else if (signals.strength <= CONFIG.weakTrendThreshold) {
          debugLog('INFO', 'STRATEGY', `智能策略切换: 建议使用网格策略 (信号强度${signals.strength} <= ${CONFIG.weakTrendThreshold})`)
        }
        // Otherwise continue with current strategy - no logging needed
      }

      // DCA check
      const canAddPosition = CONFIG.dcaEnabled &&
        dcaPositionCount < CONFIG.dcaMaxPositions &&
        pnlPercent !== null && pnlPercent <= CONFIG.dcaAddPercent

      if (canAddPosition) {
        const now = Date.now()
        const dcaCooldownMs = CONFIG.dcaCooldownMinutes * 60 * 1000
        const timeSinceLastAdd = now - lastAddPositionTime

        if (timeSinceLastAdd >= dcaCooldownMs) {
          const addAmount = CONFIG.dcaAddAmount
          const balanceAvail = balance?.available ?? 0
          const maxAffordable = balanceAvail > 0 ? (balanceAvail * 0.1 / (currentPrice / 10000)) : 0
          const actualAmount = Math.min(addAmount, Math.floor(maxAffordable * 100) / 100)

          if (actualAmount >= 0.01) {
            log(`[TrendBot] DCA加仓! 跌幅${pnlPercent.toFixed(2)}% >= ${CONFIG.dcaAddPercent}%`)
            await openLong(currentPrice, actualAmount)
            updateDCAState(actualAmount, currentPrice)
            lastAddPositionTime = now
            recordTrade('open', 'long', actualAmount, currentPrice, `DCA加仓(${pnlPercent.toFixed(2)}%)`)
          }
        }
      }

      // Sell signal
      if (signals.sell) {
        log(`[TrendBot] 平多仓: ${position.size} BTC @ $${currentPrice}`)
        if (canTrade()) {
          await closeLong(currentPrice, position.size)
          recordTrade('close', 'long', position.size, currentPrice, signals.reason.join(' + '), pnlPercent)
          signalHistory.lastTradeTime = Date.now()
          resetDCAState()
          resetTrailingState()
        }
      }
    } else {
      // No position - check for buy signal
      if (signals.buy) {
        const balanceAvail = balance?.available ?? 0
        const positionPercent = calculatePositionPercent(signals.strength, balanceAvail)
        const amount = balanceAvail > 0 ? (balanceAvail * (positionPercent / 100) * CONFIG.leverage / currentPrice) : 0

        if (amount >= 0.01 && canTrade()) {
          log(`[TrendBot] 开多仓: ${amount.toFixed(4)} BTC @ $${currentPrice} (信号强度${signals.strength}, 仓位比例${positionPercent}%)`)
          await openLong(currentPrice, amount)
          updateDCAState(amount, currentPrice)
          recordTrade('open', 'long', amount, currentPrice, signals.reason.join(' + '))
          signalHistory.lastTradeTime = Date.now()
          lastAddPositionTime = Date.now()
          trailingActive = false
        }
      }
    }

    // Log check data
    try {
      const stmt = getDb().prepare(`
        INSERT INTO check_logs (
          timestamp, price, position_size, position_entry_price,
          balance_total, balance_available, rsi, ma10, ma20, ma50,
          macd_hist, trend, volume_ok, signal_buy, signal_sell,
          signal_strength, signal_reason, action, action_amount, action_price, pnl_percent,
          bollinger_b, stoch_k, stoch_d, atr, adx, plus_di, minus_di
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        new Date().toISOString(),
        currentPrice,
        position?.size || 0,
        position?.entry_price || null,
        balance?.total || null,
        balance?.available || null,
        signals.rsi,
        signals.ma10,
        signals.ma20,
        signals.ma50,
        signals.macdHist,
        signals.trendUp ? 'up' : 'down',
        signals.volumeOK ? 1 : 0,
        signals.buy ? 1 : 0,
        signals.sell ? 1 : 0,
        signals.strength,
        signals.reason.join('; '),
        null,
        null,
        null,
        pnlPercent,
        signals.bollingerB,
        signals.stochK,
        signals.stochD,
        signals.atr,
        signals.adx,
        signals.plusDI,
        signals.minusDI
      )
    } catch (e: any) {
      log(`[TrendBot] 记录日志失败: ${e.message}`)
    }
  } catch (e: any) {
    log(`[TrendBot] 交易循环错误: ${e.message}`)
  }
}

// ============ Bot Lifecycle ============
let botInterval: NodeJS.Timeout | null = null

export async function startTrendBot() {
  initializeDatabase()

  // Check if this strategy is active
  if (!isActiveStrategy()) {
    const row = getDb().prepare('SELECT active_strategy FROM settings WHERE id = 1').get() as any
    log(`[TrendBot] 当前策略是 ${row?.active_strategy || '未知'}，不启动 Trend Bot`)
    return
  }

  const settings = loadTradingSettings()
  CONFIG.leverage = settings.leverage

  log('[TrendBot] 趋势交易机器人 V2 启动')
  log(`[TrendBot] 配置: ${CONFIG.symbol}, 杠杆: ${CONFIG.leverage}x`)
  log(`[TrendBot] RSI: 超卖<${CONFIG.rsiOversold}, 超买>${CONFIG.rsiOverbought}`)
  log(`[TrendBot] 止盈${CONFIG.takeProfitPercent}%, 止损${CONFIG.stopLossPercent}%`)

  writeHeartbeat('alive')
  writeHeartbeat()

  // Initial run
  await tradeCycle()

  // Schedule regular runs
  botInterval = setInterval(async () => {
    writeHeartbeat('alive')
    writeHeartbeat()

    const position = await getPosition()
    checkInterval = (position && position.size !== 0)
      ? CONFIG.checkIntervalWithPosition
      : CONFIG.checkIntervalWithoutPosition

    await tradeCycle()
  }, checkInterval)

  // Handle shutdown
  process.on('exit', () => {
    writeHeartbeat('offline')
    writeHeartbeat('offline')
  })
  process.on('SIGINT', () => {
    writeHeartbeat('offline')
    writeHeartbeat('offline')
    process.exit()
  })
  process.on('SIGTERM', () => {
    writeHeartbeat('offline')
    writeHeartbeat('offline')
    process.exit()
  })
}

export function stopTrendBot() {
  if (botInterval) {
    clearInterval(botInterval)
    botInterval = null
  }
  writeHeartbeat('offline')
  writeHeartbeat('offline')
}
