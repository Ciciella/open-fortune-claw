# 交易机器人开发计划

> 创建时间: 2026-03-20
> 最后更新: 2026-03-20

---

## 概述

本项目为 Gate.io 测试网趋势交易机器人的优化开发计划，包含 4 个主要功能模块。

---

## 1. 分批建仓 (DCA)

**目标：** 跌时加仓拉低成本，行情反转更快盈利

### 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| maxPositionCount | 3 | 最多持仓批次 |
| addPositionPercent | -2 | 跌幅超过 X% 加仓 |
| addPositionAmount | 5 | 每次加仓数量 (BTC) |
| addPositionCooldown | 30 | 加仓冷却时间 (分钟) |

### 逻辑流程

```
IF 有持仓 AND 持仓数 < maxPositionCount:
    IF (当前价 - 持仓均价) / 持仓均价 <= addPositionPercent:
        IF 距离上次加仓 >= cooldown:
            加仓!
```

### 状态记录

需要记录：
- `positionCount`: 当前持仓批次
- `avgEntryPrice`: 平均持仓成本
- `lastAddPositionTime`: 上次加仓时间

---

## 2. 移动止盈 + 追踪止损

**目标：** 保护利润，让利润奔跑

### 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| initialTP | 3% | 初始止盈点 |
| trailingPercent | 1% | 移动止损：盈利回落 X% 就平 |
| minTrailingTP | 2% | 最低保留止盈 |
| maxTrailingTP | 5% | 最高止盈点 |

### 逻辑流程

```
// 盈利达到 initialTP 时激活
IF 盈利 >= initialTP:
    highestPrice = 当前价
    
    // 上涨时抬高最高价
    WHILE 当前价 > highestPrice:
        highestPrice = 当前价
    
    // 回落 trailingPercent 就平仓
    IF (highestPrice - 当前价) / highestPrice >= trailingPercent:
        平仓!
```

### 状态记录

需要记录：
- `trailingActive`: 移动止盈是否激活
- `highestPrice`: 激活后的最高价
- `trailingTP`: 当前移动止盈线

---

## 3. 动态仓位

**目标：** 信号强多开，信号弱少开，风险可控

### 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| basePercent | 10% | 基础仓位占比 |
| maxPercent | 20% | 最大仓位 |
| minPercent | 5% | 最小仓位 |
| signalStrong | 5 | 强信号阈值 |
| signalWeak | 2 | 弱信号阈值 |
| strongMultiplier | 1.5 | 强信号仓位倍数 |
| weakMultiplier | 0.5 | 弱信号仓位倍数 |

### 逻辑流程

```
// 根据信号强度计算仓位
IF 信号强度 >= signalStrong:
    仓位 = basePercent × strongMultiplier
ELSE IF 信号强度 <= signalWeak:
    仓位 = basePercent × weakMultiplier
ELSE:
    仓位 = basePercent

// 余额过低时自动降低
IF 可用余额 < 1000 USDT:
    仓位 = minPercent
```

---

## 4. 多策略组合

**目标：** 震荡+趋势都能盈利

### 策略池

| 策略 | 文件 | 说明 |
|------|------|------|
| 趋势策略 | trend-bot.js | 专职大行情 |
| 网格策略 | grid-bot.js | 区间震荡套利 |
| 资金费率套利 | arbitrage-bot.js | 跨期套利 |

### 运行模式

#### 模式A: 趋势为主，网格为辅
- 趋势策略：专职大行情
- 网格策略：区间震荡时每笔赚 0.1%

#### 模式B: 资金费率套利
- 做多现货 + 做空合约
- 赚取 funding rate

#### 模式C: 智能切换
- 检测趋势强度
- 趋势强 → 启用趋势策略
- 趋势弱 → 启用网格策略

---

## 优先级

| 优先级 | 功能 | 复杂度 | 预计工时 |
|--------|------|--------|----------|
| ⭐⭐⭐ | 1. 分批建仓 | 低 | 2h |
| ⭐⭐⭐ | 2. 移动止盈 | 中 | 3h |
| ⭐⭐ | 3. 动态仓位 | 中 | 3h |
| ⭐ | 4. 多策略组合 | 高 | 8h |

---

## 开发日志

### 2026-03-20
- [x] 创建开发计划文档
- [x] 实现分批建仓 (DCA) 功能

#### 分批建仓 (DCA) 实现细节

**新增配置参数：**
```javascript
dcaEnabled: true,           // 开启分批建仓
dcaMaxPositions: 3,        // 最多3批持仓
dcaAddPercent: -2,         // 跌幅超过2%加仓
dcaAddAmount: 5,           // 每次加仓数量 (BTC)
dcaCooldownMinutes: 30,    // 加仓冷却时间 (分钟)
dcaReduceOnTP: true        // 止盈时是否减仓
```

**新增状态变量：**
- `dcaPositionCount`: 当前持仓批次数
- `dcaAvgEntryPrice`: 平均持仓成本
- `lastAddPositionTime`: 上次加仓时间

**核心逻辑：**
1. 首次建仓记录批次=1
2. 价格跌幅达到 `dcaAddPercent` 时触发加仓
3. 加仓后冷却 `dcaCooldownMinutes` 分钟
4. 最多 `dcaMaxPositions` 批
5. 任何平仓（止盈/止损/信号）后重置 DCA 状态

**文件修改：**
- `trend-bot.js`: ~150行修改
