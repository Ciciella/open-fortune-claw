import { getDb, all, get, run } from './database.js'
import { fetchPositionsAndBalance, futuresApi } from './gate_api.js'

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
  dcaMaxPositions: 5,
  dcaAddPercent: -3,
  dcaAddAmount: 0.01,
  dcaCooldownMinutes: 10,
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
      pnl_percent REAL
    )
  `)

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
      updated_at TEXT NOT NULL
    )
  `)

  // Initialize settings row if not exists
  const settingsRow = db.prepare('SELECT leverage FROM settings WHERE id = 1').get()
  if (!settingsRow) {
    db.prepare('INSERT INTO settings (id, leverage, updated_at) VALUES (1, 10, ?)').run(new Date().toISOString())
  }

  console.log('[TrendBot] Database initialized')
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
    const currency = CONFIG.symbol.replace('_USDT', '/USDT')
    const url = `https://api-testnet.gateapi.io/api/v4/futures/usdt/candlesticks?currency_pair=${currency}&interval=${interval}&limit=${limit}`
    
    const response = await fetch(url)
    const data = await response.json()
    
    if (Array.isArray(data)) {
      // Gate.io returns [timestamp, volume, close, high, low, open]
      return data.map((k: any) => ({
        time: k[0] / 1000,
        open: parseFloat(k[5]),
        high: parseFloat(k[3]),
        low: parseFloat(k[4]),
        close: parseFloat(k[2]),
        volume: parseFloat(k[1]),
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
    }
  }

  const closes = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)

  const rsi = calculateRSI(closes, CONFIG.rsiPeriod)
  const ma10 = calculateEMA(closes.slice(-10), 10)
  const ma20 = calculateEMA(closes.slice(-20), 20)
  const ma50 = calculateEMA(closes.slice(-50), 50)
  const { histogram: macdHist } = calculateMACD(closes)

  const currentPrice = closes[closes.length - 1]
  const trendUp = ma10 > ma20 && ma20 > ma50
  const volumeAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
  const volumeOK = volumes[volumes.length - 1] > volumeAvg * 0.8

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
  }

  // Buy signal conditions
  if (rsi < CONFIG.rsiOversold) {
    signals.reason.push(`RSI超卖(${rsi.toFixed(1)}<${CONFIG.rsiOversold})`)
    signals.strength += 1
  }

  if (trendUp && CONFIG.trendFilter) {
    signals.reason.push('趋势向上')
    signals.strength += 1
  }

  if (macdHist > 0) {
    signals.reason.push('MACD柱为正')
    signals.strength += 1
  }

  // Final buy/sell determination
  signals.buy = signals.strength >= 2 && rsi < CONFIG.rsiOversold && trendUp

  // Sell signal
  if (rsi > CONFIG.rsiOverbought) {
    signals.sell = true
    signals.reason.push(`RSI超买(${rsi.toFixed(1)}>${CONFIG.rsiOverbought})`)
  }

  if (macdHist < 0 && signals.strength < 2) {
    signals.sell = true
    signals.reason.push('MACD柱为负')
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

// ============ Main Trade Cycle ============
let checkInterval = CONFIG.checkIntervalWithoutPosition

async function tradeCycle() {
  try {
    const position = await getPosition()
    const balance = await getFuturesBalance()
    const currentPrice = position?.current_price || cachedBalance?.total || 0

    if (!currentPrice) {
      log('[TrendBot] 无法获取当前价格')
      return
    }

    const signals = await detectSignals()
    log(`[TrendBot] 价格: $${currentPrice}, RSI: ${signals.rsi.toFixed(1)}, 信号: ${signals.buy ? '买入' : signals.sell ? '卖出' : '观望'}`)

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
        }
        return
      }

      // Take profit check
      if (pnlPercent !== null && pnlPercent >= CONFIG.takeProfitPercent) {
        log(`[TrendBot] 触发止盈! 盈利${pnlPercent.toFixed(2)}%`)
        if (canTrade()) {
          await closeLong(currentPrice, position.size)
          recordTrade('close', 'long', position.size, currentPrice, `止盈(${pnlPercent.toFixed(2)}%)`, pnlPercent)
          signalHistory.lastTradeTime = Date.now()
          resetDCAState()
        }
        return
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
        }
      }
    } else {
      // No position - check for buy signal
      if (signals.buy) {
        let amount = CONFIG.baseTradeAmount
        const balanceAvail = balance?.available ?? 0
        const maxAffordable = balanceAvail > 0 ? (balanceAvail * 0.1 / (currentPrice / 10000)) : 0
        amount = Math.min(amount, Math.floor(maxAffordable * 100) / 100)
        amount = Math.max(amount, 0.001)

        if (amount >= 0.01 && canTrade()) {
          log(`[TrendBot] 开多仓: ${amount} BTC @ $${currentPrice}`)
          await openLong(currentPrice, amount)
          updateDCAState(amount, currentPrice)
          recordTrade('open', 'long', amount, currentPrice, signals.reason.join(' + '))
          signalHistory.lastTradeTime = Date.now()
          lastAddPositionTime = Date.now()
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
          signal_strength, signal_reason, action, action_amount, action_price, pnl_percent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        pnlPercent
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
