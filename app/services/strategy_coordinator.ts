/**
 * Strategy Coordinator - 智能策略协调器
 * 
 * 根据市场状态自动在 trend/grid/arbitrage 策略间切换
 * 避免多个 bot 同时运行冲突
 */

import { getDb } from './database.js'

export type StrategyType = 'trend' | 'grid' | 'arbitrage'

export interface MarketState {
  regime: 'trending' | 'ranging' | 'volatile'  // 市场状态
  adx: number
  atr: number
  volatility: number  // 波动率百分比
  volume: number
  timestamp: string
}

// 策略配置
interface StrategyConfig {
  minAdx: number        // ADX 最小值（趋势强度）
  maxAdx: number        // ADX 最大值
  maxVolatility: number // 最大波动率
  minVolatility: number // 最小波动率
  description: string
}

const STRATEGY_CONFIGS: Record<StrategyType, StrategyConfig> = {
  trend: {
    minAdx: 25,         // 强趋势
    maxAdx: 100,
    minVolatility: 1,   // 至少 1% 波动
    maxVolatility: 10,  // 但不超过 10%（过于波动风险大）
    description: '趋势交易 - 适用于明确的方向性运动'
  },
  grid: {
    minAdx: 0,
    maxAdx: 20,         // 弱趋势或无趋势
    minVolatility: 0.5, // 需要一定波动来获利
    maxVolatility: 5,   // 但不宜过大
    description: '网格交易 - 适用于区间震荡'
  },
  arbitrage: {
    minAdx: 0,
    maxAdx: 100,        // 任何市场状态都可以
    minVolatility: 0,
    maxVolatility: 100,
    description: '资金费率套利 - 低风险对冲'
  }
}

/**
 * 分析当前市场状态
 */
export function analyzeMarket(
  adx: number,
  atr: number,
  currentPrice: number,
  volume: number
): MarketState {
  // 计算波动率（ATR 相对于价格的百分比）
  const volatility = currentPrice > 0 ? (atr / currentPrice) * 100 : 0

  // 判断市场状态
  let regime: 'trending' | 'ranging' | 'volatile'
  
  if (adx > 30) {
    regime = 'trending'  // 强趋势
  } else if (volatility > 5) {
    regime = 'volatile'  // 高波动
  } else {
    regime = 'ranging'   // 震荡
  }

  return {
    regime,
    adx,
    atr,
    volatility,
    volume,
    timestamp: new Date().toISOString()
  }
}

/**
 * 根据市场状态推荐最佳策略
 */
export function recommendStrategy(market: MarketState): {
  strategy: StrategyType
  confidence: number  // 0-100 置信度
  reason: string
} {
  const { adx, volatility } = market

  // 评估每个策略的适用性
  const scores: Record<StrategyType, number> = {
    trend: 0,
    grid: 0,
    arbitrage: 0
  }

  // Trend strategy scoring
  const trendConfig = STRATEGY_CONFIGS.trend
  if (adx >= trendConfig.minAdx && adx <= trendConfig.maxAdx &&
      volatility >= trendConfig.minVolatility && volatility <= trendConfig.maxVolatility) {
    scores.trend = 80 + Math.min(20, (adx - 25) / 2) // 高 ADX 更有信心
  } else if (adx >= 20) {
    scores.trend = 40 // 部分符合
  }

  // Grid strategy scoring
  const gridConfig = STRATEGY_CONFIGS.grid
  if (adx <= gridConfig.maxAdx &&
      volatility >= gridConfig.minVolatility && volatility <= gridConfig.maxVolatility) {
    scores.grid = 80 + Math.min(20, (20 - adx)) // 低 ADX 更有信心
  } else if (adx <= 25) {
    scores.grid = 40 // 部分符合
  }

  // Arbitrage is always viable but lower priority
  scores.arbitrage = 30 // 基础分数，稳定但收益较低

  // 选择最高分策略
  let bestStrategy: StrategyType = 'trend'
  let bestScore = 0

  for (const [strategy, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score
      bestStrategy = strategy as StrategyType
    }
  }

  // 生成原因
  let reason = ''
  if (bestStrategy === 'trend') {
    reason = `ADX=${adx.toFixed(1)} 显示强趋势，波动率 ${volatility.toFixed(2)}% 适中`
  } else if (bestStrategy === 'grid') {
    reason = `ADX=${adx.toFixed(1)} 显示弱趋势/震荡，波动率 ${volatility.toFixed(2)}% 适合网格`
  } else {
    reason = '市场条件不确定，建议使用低风险套利策略'
  }

  return {
    strategy: bestStrategy,
    confidence: bestScore,
    reason
  }
}

/**
 * 切换活跃策略
 */
export function switchActiveStrategy(newStrategy: StrategyType): {
  success: boolean
  previousStrategy: string
  message: string
} {
  try {
    const db = getDb()
    
    // 获取当前策略
    const currentRow = db.prepare(
      'SELECT active_strategy FROM settings WHERE id = 1'
    ).get() as any
    
    const previousStrategy = currentRow?.active_strategy || 'trend'

    // 如果已经是当前策略，不需要切换
    if (previousStrategy === newStrategy) {
      return {
        success: true,
        previousStrategy,
        message: `当前已是 ${newStrategy} 策略，无需切换`
      }
    }

    // 更新策略
    db.prepare(
      'UPDATE settings SET active_strategy = ?, updated_at = ? WHERE id = 1'
    ).run(newStrategy, new Date().toISOString())

    // 记录切换日志
    db.prepare(`
      INSERT INTO check_logs (timestamp, action, signal_reason)
      VALUES (?, ?, ?)
    `).run(
      new Date().toISOString(),
      `strategy_switch:${previousStrategy}->${newStrategy}`,
      `自动策略切换: ${previousStrategy} -> ${newStrategy}`
    )

    console.log(`[Strategy Coordinator] 策略已切换: ${previousStrategy} -> ${newStrategy}`)

    return {
      success: true,
      previousStrategy,
      message: `策略已从 ${previousStrategy} 切换到 ${newStrategy}`
    }
  } catch (e: any) {
    console.error(`[Strategy Coordinator] 策略切换失败: ${e.message}`)
    return {
      success: false,
      previousStrategy: 'unknown',
      message: `切换失败: ${e.message}`
    }
  }
}

/**
 * 获取当前活跃策略
 */
export function getActiveStrategy(): StrategyType {
  try {
    const db = getDb()
    const row = db.prepare(
      'SELECT active_strategy FROM settings WHERE id = 1'
    ).get() as any
    return row?.active_strategy || 'trend'
  } catch {
    return 'trend'
  }
}

/**
 * 自动评估并切换策略（由趋势机器人定期调用）
 */
export function autoEvaluateAndSwitch(
  adx: number,
  atr: number,
  currentPrice: number,
  volume: number
): {
  switched: boolean
  newStrategy?: StrategyType
  reason: string
} {
  const market = analyzeMarket(adx, atr, currentPrice, volume)
  const recommendation = recommendStrategy(market)
  const currentStrategy = getActiveStrategy()

  // 仅当置信度 > 70 且与当前策略不同时才切换
  if (recommendation.confidence >= 70 && recommendation.strategy !== currentStrategy) {
    const result = switchActiveStrategy(recommendation.strategy)
    return {
      switched: result.success,
      newStrategy: recommendation.strategy,
      reason: `${recommendation.reason} (置信度: ${recommendation.confidence.toFixed(0)}%)`
    }
  }

  return {
    switched: false,
    reason: `当前策略 ${currentStrategy} 仍然适用 (推荐: ${recommendation.strategy}, 置信度: ${recommendation.confidence.toFixed(0)}%)`
  }
}
