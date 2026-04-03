# 开空单问题修复说明

## 问题描述
趋势交易机器人无法正常开空单（short position），所有 `sell` 订单都被当作平多仓处理。

## 根本原因

在 `app/services/trend_bot.ts` 文件中，存在**两个关键问题**：

### 问题 1: 错误地在订单中包含 leverage 参数
根据 Gate.io Futures API 规范：
- **`leverage` 参数不应该在下单时传递**
- 正确的做法是：**先通过专门的 API 设置合约杠杆，然后再下单**

### 问题 2: 开空单时 size 应为负数
**关键发现**：在 Gate.io 的**单向持仓模式（one-way mode）**下：
- **多仓**: `size` 为**正数**
- **空仓**: `size` 为**负数**
- 如果 `sell` 订单的 `size` 为正数，系统会将其当作**平多仓**处理，而不是开空仓

原始代码中，`openShort` 函数使用了正数的 `contractSize`，导致无法正确开空单。

### 原始错误代码
```typescript
// openLong - 错误示例
const order = {
  contract: CONFIG.symbol,
  type: 'buy',
  price: '0',
  size: String(contractSize),  // ❌ 正数
  leverage: String(settings.leverage),  // ❌ 错误：不应在此传递
  tif: 'ioc',
}

// openShort - 错误示例  
const order = {
  contract: CONFIG.symbol,
  type: 'sell',
  price: '0',
  size: String(contractSize),  // ❌ 正数 - 这会被当作平多仓！
  leverage: String(settings.leverage),  // ❌ 错误：不应在此传递
  tif: 'ioc',
}
```

## 修复方案

### 1. 添加设置杠杆的函数

在 `trend_bot.ts` 中新增 `setLeverage` 函数：

```typescript
async function setLeverage(leverage: number): Promise<boolean> {
  try {
    const result = await futuresApi.updatePositionLeverage('usdt', CONFIG.symbol, String(leverage))
    debugLog('INFO', 'LEVERAGE', `设置杠杆成功: ${leverage}x`, result.body)
    return true
  } catch (e: any) {
    const msg = e.response?.body?.message || e.message
    debugLog('WARN', 'LEVERAGE', `设置杠杆失败: ${msg}，将尝试继续下单`, e.response?.body || null)
    // 不阻断交易流程，继续尝试下单
    return true
  }
}
```

### 2. 修改 openLong 函数

- 移除订单对象中的 `leverage` 参数
- 在下单前调用 `setLeverage` 设置杠杆

```typescript
async function openLong(price: number, size: number): Promise<boolean> {
  try {
    const settings = loadTradingSettings()
    // 设置杠杆
    await setLeverage(settings.leverage)  // ✅ 先设置杠杆
    
    const contractSize = Math.abs(Math.floor(size * price))
    if (contractSize < 10) {
      debugLog('WARN', 'TRADE', `开多订单太小: ${size} BTC (${contractSize} contracts) < 最小10 contracts`)
      return false
    }
    
    const order = {
      contract: CONFIG.symbol,
      type: 'buy',
      price: '0',
      size: String(contractSize),  // ✅ 正数表示多仓
      tif: 'ioc',
    }

    const result = await futuresApi.createFuturesOrder('usdt', order)
    // ...
  } catch (e: any) {
    // ...
  }
}
```

### 3. 修改 openShort 函数（关键修复）

**核心修改**：使用**负数的 `size`** 来表示空单

```typescript
async function openShort(price: number, size: number): Promise<boolean> {
  try {
    const settings = loadTradingSettings()
    // 设置杠杆
    await setLeverage(settings.leverage)  // ✅ 先设置杠杆
    
    // 关键：开空单需要使用负数的 size！
    const contractSize = -Math.abs(Math.floor(size * price))  // ✅ 负数表示空单
    if (Math.abs(contractSize) < 10) {
      debugLog('WARN', 'TRADE', `开空订单太小: ${size} BTC (${Math.abs(contractSize)} contracts) < 最小10 contracts`)
      return false
    }
    
    const order = {
      contract: CONFIG.symbol,
      type: 'sell',  // 开空 = 卖出
      price: '0',
      size: String(contractSize),  // ✅ 负数！
      tif: 'ioc',
    }

    const result = await futuresApi.createFuturesOrder('usdt', order)
    // ...
  } catch (e: any) {
    // ...
  }
}
```

## 修改的文件

- `app/services/trend_bot.ts`
  - 新增 `setLeverage` 函数（约第345行）
  - 修改 `openLong` 函数：移除 `leverage` 参数，在下单前调用 `setLeverage()`
  - 修改 `openShort` 函数：**使用负数的 `size`**，移除 `leverage` 参数，在下单前调用 `setLeverage()`

## 测试验证

### 1. 单元测试

运行项目测试确保修改正确：

```bash
npm test
```

测试结果：
```
▶ 开仓合约数量计算
  ✔ openShort 应正确将 BTC 数量转换为合约数量
  ✔ openLong 应正确将 BTC 数量转换为合约数量
  ✔ closeLong 应正确将 BTC 数量转换为合约数量
  ✔ 订单最小数量检查 - 小于10 contracts应被拒绝
  ✔ 正常订单数量应大于最小值
✔ 开仓合约数量计算
```

所有测试通过 ✅

### 2. 实际开空单测试

成功开空单并验证：

```
当前价格: 66843.1

1. 平掉现有持仓...
2. 尝试开空单（使用负数size）...
订单参数: { contract: 'BTC_USDT', type: 'sell', price: '0', size: '-66', tif: 'ioc' }

订单结果:
ID: 82472171301469119
Status: finished
Size: -66
Fill Price: 66843.1

3. 检查持仓...
=== 当前空单持仓 ===
Size: -66 (空单) ✅
开仓价: 66843.1
当前价: 66834.68
未实现盈亏: +0.055572 USDT (盈利！价格下跌)
杠杆: 10 x
```

**验证成功**：
- ✅ Size 为负数 (-66)，正确识别为空单
- ✅ 价格下跌时盈利（从 66843.1 降到 66834.68）
- ✅ 未实现盈亏为正 (+0.055572 USDT)

## Gate.io API 说明

根据 Gate.io 官方文档：

### 单向持仓模式 (One-Way Mode)
- **多仓**: `size > 0` (正数)
- **空仓**: `size < 0` (负数)
- 无法同时持有多仓和空仓

### 设置杠杆
- **设置杠杆**: `updatePositionLeverage(settle, contract, leverage)`
  - 这是一个单独的 API 调用
  - 必须在下单前完成设置
  
- **创建订单**: `createFuturesOrder(settle, futuresOrder)`
  - 订单对象中**不应包含** `leverage` 字段
  - 杠杆应提前通过 `updatePositionLeverage` 设置

### 双向持仓模式 (Hedge Mode)
- 可以同时持有多仓和空仓
- 需要使用 `setDualMode` API 切换
- 注意：Gate.io **测试网**可能不支持双向模式

## 注意事项

1. **关键修复**：开空单时必须使用**负数的 `size`**
2. **杠杆设置**：通过 `setLeverage()` 提前设置，不在订单中包含
3. **杠杆设置失败不会阻止下单**：`setLeverage` 函数即使失败也会返回 `true`
4. **日志记录**：所有操作都会被记录到 debug_logs 表中
5. **测试网限制**：Gate.io 测试网可能不支持双向持仓模式

## 启动趋势交易机器人

```bash
npm run trend:bot
```

现在机器人应该能够正常开多单和空单了！

## 如何平掉空单

空单的平仓方向是**买入**：

```typescript
// 平空单 = 买入
const order = {
  contract: 'BTC_USDT',
  type: 'buy',  // 买入
  size: '0',    // size=0 表示全部平仓
  close: true,  // 关闭持仓标志
  tif: 'gtc',
}
```
