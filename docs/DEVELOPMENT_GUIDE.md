# Open Fortune Claw - 开发文档

> 文档版本: 1.1.0
> 创建时间: 2026-04-02
> 最后更新: 2026-04-02

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [项目结构](#3-项目结构)
4. [核心模块详解](#4-核心模块详解)
5. [API 接口文档](#5-api-接口文档)
6. [数据库设计](#6-数据库设计)
7. [交易策略](#7-交易策略)
8. [开发指南](#8-开发指南)
9. [部署说明](#9-部署说明)
10. [常见问题](#10-常见问题)

---

## 1. 项目概述

### 1.1 项目简介

Open Fortune Claw 是一个基于 **AdonisJS 7 + TypeScript** 构建的加密货币自动交易机器人系统，支持多种交易策略和实时监控 Dashboard。

### 1.2 核心功能

| 功能 | 描述 |
|------|------|
| **Dashboard** | 实时查看交易状态、持仓、盈亏 |
| **趋势交易** | 基于 RSI、MA、MACD、ADX 等多指标自动交易，支持 DCA 加仓、移动止盈 |
| **网格交易** | 区间震荡自动低买高卖 |
| **资金费率套利** | 跨交易所对冲赚取资金费率 |
| **策略切换** | 支持动态切换不同交易策略 |
| **自动盯盘** | 7×24 小时自动执行交易策略 |

### 1.3 技术特点

- **现代化框架**: AdonisJS 7 + TypeScript
- **类型安全**: 完整的 TypeScript 类型定义
- **模块化设计**: 服务层、控制层分离
- **持久化存储**: SQLite 本地数据库
- **第三方 API**: Gate.io 测试网永续合约 API

### 1.4 支持的交易对

| 交易对 | 状态 | 说明 |
|--------|------|------|
| BTC_USDT | ✅ 已支持 | 主流交易对 |
| ETH_USDT | ✅ 已支持 | 主流交易对 |

---

## 2. 技术架构

### 2.1 技术栈

```
┌─────────────────────────────────────────────────────────┐
│                      前端层                              │
│                  Dashboard (index.html)                  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      API 层                             │
│                   AdonisJS Router                       │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Controller 层                         │
│    HTTP Controllers (状态、数据、控制)                     │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Service 层                            │
│   trend_bot | grid_bot | arbitrage_bot | gate_api      │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    数据层                                │
│              SQLite + Gate.io API                        │
└─────────────────────────────────────────────────────────┘
```

### 2.2 运行环境

- **Node.js**: >= 22.0.0
- **包管理器**: npm

### 2.3 依赖关系

| 依赖包 | 版本 | 用途 |
|--------|------|------|
| @adonisjs/core | ^7.0.0 | Web 框架 |
| @adonisjs/cors | ^3.0.0 | CORS 中间件 |
| @adonisjs/validator | ^13.0.0 | 数据验证 |
| better-sqlite3 | ^12.8.0 | SQLite 数据库 (同步) |
| gate-api | ^7.0.0 | Gate.io API SDK |
| dotenv | ^16.6.0 | 环境变量加载 |
| tsx | ^4.21.0 | TypeScript 执行器 |

---

## 3. 项目结构

```
open-fortune-claw/
├── app/
│   ├── app.ts                     # 应用入口
│   ├── controllers/
│   │   └── Http/                  # HTTP 控制器 (大写开头)
│   │       ├── BalanceController.ts
│   │       ├── ConfigController.ts
│   │       ├── DashboardController.ts
│   │       ├── DebugLogController.ts
│   │       ├── HealthController.ts
│   │       ├── LogController.ts
│   │       ├── PositionController.ts
│   │       ├── StatsController.ts
│   │       ├── StatusController.ts
│   │       ├── StrategyController.ts
│   │       ├── TradeController.ts
│   │       └── TradingSettingsController.ts
│   └── services/                  # 业务逻辑服务
│       ├── trend_bot.ts           # 趋势交易机器人
│       ├── grid_bot.ts            # 网格交易机器人
│       ├── arbitrage_bot.ts       # 资金费率套利机器人
│       ├── gate_api.ts            # Gate.io API 封装
│       └── database.ts            # 数据库封装
├── bin/
│   ├── ace.ts                     # ACE CLI 入口
│   └── server.ts                  # HTTP 服务器入口
├── commands/                      # CLI 命令
│   ├── index.ts
│   ├── trend_bot_command.ts
│   ├── grid_bot_command.ts
│   ├── arbitrage_bot_command.ts
│   └── reset_data_command.ts
├── config/
│   ├── app.ts                     # 应用配置
│   ├── cors.ts                    # CORS 配置
│   └── hashing.ts                 # 哈希配置
├── data/                          # 数据目录
│   └── trading.db                 # SQLite 数据库
├── start/
│   ├── kernel.ts                  # HTTP 中间件
│   └── routes.ts                  # 路由定义
├── providers/
│   └── app_provider.ts            # 应用服务提供者
├── docs/                          # 文档目录
│   ├── DEVELOPMENT_GUIDE.md       # 开发指南
│   ├── DEVELOPMENT_PLAN.md        # 开发计划
│   └── REFACTOR_PLAN.md           # 重构计划
├── index.html                     # Dashboard 前端页面
├── .env.example                   # 环境变量模板
├── package.json
├── tsconfig.json
└── config.js                      # Dashboard 配置 (API_BASE_URL)
```

### 3.1 目录说明

| 目录 | 说明 |
|------|------|
| `app/controllers/Http/` | HTTP 控制器，处理 API 请求 |
| `app/services/` | 业务逻辑服务，包含交易机器人核心代码 |
| `bin/` | 应用入口文件 |
| `commands/` | AdonisJS ACE 命令 |
| `config/` | AdonisJS 配置文件 |
| `start/` | 路由和中间件定义 |
| `data/` | SQLite 数据库文件存储目录 |

---

## 4. 核心模块详解

### 4.1 Gate API 服务 (`app/services/gate_api.ts`)

**职责**: 封装 Gate.io 测试网 API，提供持仓、余额查询和下单功能。

**核心接口**:

```typescript
interface Position {
  symbol: string
  side: 'long' | 'short'
  amount: number
  entry_price: number
  current_price: number
  pnl: number
  leverage: number
  updated_at: string
}

interface Balance {
  total: number
  available: number
  unrealisedPnl: number
}

export async function fetchPositionsAndBalance(): Promise<{
  positions: Position[]
  balance: Balance | null
  error?: string
}>
```

**配置**:

```typescript
const config = {
  apiKey: process.env.GATE_TESTNET_API_KEY,
  apiSecret: process.env.GATE_TESTNET_API_SECRET,
  basePath: 'https://api-testnet.gateapi.io/api/v4'
}
```

### 4.2 数据库服务 (`app/services/database.ts`)

**职责**: 封装 SQLite 数据库操作，提供同步数据库访问。

**核心函数**:

```typescript
export function getDb(): DatabaseSync
export function closeDb()
export function all<T>(sql: string, params?: any[]): T[]
export function get<T>(sql: string, params?: any[]): T | undefined
export function run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number }
```

**数据库路径**: `data/trading.db`

### 4.3 趋势交易机器人 (`app/services/trend_bot.ts`)

**职责**: 实现基于技术指标的自动趋势交易策略。

**核心配置**:

```typescript
interface Config {
  symbol: string                    // 交易对
  rsiOversold: number               // RSI 超卖阈值 (默认 35)
  rsiOverbought: number             // RSI 超买阈值 (默认 70)
  rsiPeriod: number                 // RSI 周期 (默认 14)
  trendFilter: boolean              // 趋势过滤 (默认 true)
  volumeConfirm: boolean           // 成交量确认 (默认 true)
  trailingStop: boolean             // 追踪止损 (默认 false)
  takeProfitPercent: number         // 止盈百分比 (默认 3%)
  stopLossPercent: number           // 止损百分比 (默认 2%)
  baseTradeAmount: number           // 基础交易量 (默认 0.01 BTC)
  cooldownMinutes: number            // 交易冷却 (默认 5 分钟)
  // DCA 配置
  dcaEnabled: boolean
  dcaMaxPositions: number
  dcaAddPercent: number
  dcaAddAmount: number
  dcaCooldownMinutes: number
  // 移动止盈配置
  initialTP: number
  trailingPercent: number
  minTrailingTP: number
  maxTrailingTP: number
  // 动态仓位配置
  basePercent: number
  maxPercent: number
  minPercent: number
  signalStrong: number
  signalWeak: number
  strongMultiplier: number
  weakMultiplier: number
}
```

**技术指标**:

| 指标 | 函数 | 说明 |
|------|------|------|
| RSI | `calculateRSI()` | 相对强弱指数 |
| EMA | `calculateEMA()` | 指数移动平均线 |
| MACD | `calculateMACD()` | 移动平均收敛发散 |
| Bollinger Bands | `calculateBollingerBands()` | 布林带 |
| Stochastic | `calculateStochastic()` | 随机指标 |
| ATR | `calculateATR()` | 平均真实波幅 |
| ADX | `calculateADX()` | 平均方向性指数 |

**信号检测**:

```typescript
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
  bollingerB: number
  stochK: number
  stochD: number
  atr: number
  adx: number
  plusDI: number
  minusDI: number
}
```

### 4.4 网格交易机器人 (`app/services/grid_bot.ts`)

**职责**: 在指定价格区间内均匀布单，自动低买高卖。

**核心配置**:

```typescript
interface Config {
  symbol: string
  gridCount: number                 // 网格数量 (默认 10)
  priceRangePercent: number          // 价格区间幅度 (默认 ±10%)
  baseAmount: number                 // 每格下单量 (默认 1 BTC)
  takeProfitPercent: number          // 止盈百分比 (默认 1%)
  stopLossPercent: number            // 止损百分比 (默认 15%)
  checkInterval: number              // 检查间隔 (默认 30 秒)
  emergencyStop: boolean             // 紧急停止标志
}
```

### 4.5 套利机器人 (`app/services/arbitrage_bot.ts`)

**职责**: 监控资金费率，跨期对冲赚取套利收益。

**核心配置**:

```typescript
interface Config {
  symbols: string[]                  // 监控的交易对 ['BTC_USDT', 'ETH_USDT']
  hedgeAmount: number                // 对冲数量 (默认 1 BTC)
  fundingThreshold: number           // 资金费率阈值 (默认 0.01%)
  maxPosition: number
  rebalanceThreshold: number         // 再平衡阈值 (默认 2%)
  checkInterval: number              // 检查间隔 (默认 60 秒)
}
```

---

## 5. API 接口文档

### 5.1 路由定义

所有 API 路由定义在 `start/routes.ts` 文件中。

### 5.2 接口列表

| 方法 | 路径 | 控制器 | 功能 |
|------|------|--------|------|
| GET | `/api/test` | HealthController | 健康检查 |
| GET | `/api/status` | StatusController | 机器人状态 |
| GET | `/api/trades` | TradeController | 交易历史 |
| GET | `/api/positions` | PositionController | 当前持仓 |
| GET | `/api/all` | DashboardController | Dashboard 全部数据 |
| GET | `/api/logs` | LogController | 操作日志 |
| GET | `/api/balance-history` | BalanceController | 余额历史 |
| GET | `/api/config` | ConfigController | 配置信息 |
| GET | `/api/stats` | StatsController | 统计数据 |
| GET | `/api/debug` | DebugLogController | 调试日志 |
| GET | `/api/trading-settings` | TradingSettingsController | 获取交易设置 |
| PUT | `/api/trading-settings` | TradingSettingsController | 更新交易设置 |
| GET | `/api/strategy` | StrategyController | 获取当前策略 |
| PUT | `/api/strategy` | StrategyController | 切换策略 |

### 5.3 响应格式

所有 API 返回统一的 JSON 格式：

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

错误响应：

```json
{
  "success": false,
  "data": null,
  "error": "错误描述"
}
```

---

## 6. 数据库设计

### 6.1 数据表结构

#### trades 表 - 交易记录

```sql
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'open' | 'close'
  side TEXT NOT NULL,           -- 'buy' | 'sell'
  amount REAL NOT NULL,
  price REAL NOT NULL,
  strategy TEXT,
  reason TEXT,
  pnl REAL DEFAULT 0
);
```

#### check_logs 表 - 策略检查日志

```sql
CREATE TABLE check_logs (
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
);
```

#### debug_logs 表 - 调试日志

```sql
CREATE TABLE debug_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,           -- 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT
);
```

#### heartbeat 表 - 机器人心跳

```sql
CREATE TABLE heartbeat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  bot_name TEXT NOT NULL DEFAULT 'trend-bot',
  status TEXT NOT NULL DEFAULT 'alive',
  price REAL,
  position_size REAL,
  balance_total REAL,
  balance_available REAL,
  pnl_percent REAL
);
```

#### settings 表 - 设置

```sql
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  leverage INTEGER NOT NULL DEFAULT 10,
  active_strategy TEXT NOT NULL DEFAULT 'trend',
  updated_at TEXT NOT NULL
);
```

### 6.2 数据库迁移

数据库初始化在 `trend_bot.ts` 的 `initializeDatabase()` 函数中完成，包含以下迁移：

- 自动添加新列到现有表（如果不存在）
- 创建索引以优化查询性能
- 初始化默认设置行

---

## 7. 交易策略

### 7.1 趋势交易策略

**开仓条件**（买入信号）:
1. RSI < 超卖阈值 (35)
2. 趋势向上 (MA10 > MA20 > MA50)
3. MACD 柱为正
4. 信号强度 >= 3

**平仓条件**（卖出信号）:
1. RSI > 超买阈值 (70)
2. 触发止盈或止损
3. MACD 柱转负

**DCA 分批建仓**:
- 价格下跌超过 `dcaAddPercent` 时加仓
- 最多 `dcaMaxPositions` 批次
- 加仓冷却时间 `dcaCooldownMinutes`

**移动止盈**:
- 盈利达到 `initialTP` 后激活
- 追踪最高价，回落 `trailingPercent` 平仓

### 7.2 网格交易策略

**原理**: 在 `[price*(1-range), price*(1+range)]` 区间内创建 `gridCount` 个网格买单和卖单。

**执行流程**:
1. 计算网格区间和网格价格
2. 在每个网格价格挂单
3. 价格触发时自动成交
4. 成交后反向挂单实现套利

### 7.3 资金费率套利策略

**原理**: 当资金费率 > 阈值时，同时开多仓和空仓持有，赚取资金费率。

**监控指标**:
- BTC_USDT 资金费率
- ETH_USDT 资金费率
- 阈值: 0.01%

---

## 8. 开发指南

### 8.1 环境配置

1. **安装依赖**:

```bash
npm install
```

2. **配置环境变量**:

复制 `.env.example` 为 `.env`:

```bash
cp .env.example .env
```

编辑 `.env` 文件:

```env
GATE_TESTNET_API_KEY=你的APIKey
GATE_TESTNET_API_SECRET=你的APISecret
PORT=3000
```

3. **获取 Gate.io 测试网 API**:

访问 https://testnet.gateio.pro 注册并获取 API 密钥。

### 8.2 启动开发服务器

```bash
# 启动 HTTP 服务器 (Dashboard)
npm run dev

# 启动趋势交易机器人
npm run trend:bot

# 启动网格交易机器人
npm run grid:bot

# 启动套利机器人
npm run arbitrage:bot

# 重置所有数据
npm run reset:data
```

### 8.3 添加新的交易策略

1. 在 `app/services/` 创建新的服务文件:

```typescript
// app/services/custom_bot.ts
export async function startCustomBot() {
  // 策略实现
}

export function stopCustomBot() {
  // 停止逻辑
}
```

2. 创建 CLI 命令:

```typescript
// commands/custom_bot_command.ts
import { BaseCommand } from '@adonisjs/core/ace'

export default class CustomBotCommand extends BaseCommand {
  static commandName = 'custom:bot'
  
  async run() {
    const { startCustomBot } = await import('../app/services/custom_bot.js')
    await startCustomBot()
  }
}
```

3. 在 `commands/index.ts` 导出命令。

### 8.4 添加新的 API 接口

1. 创建控制器:

```typescript
// app/controllers/http/custom_controller.ts
export default class CustomController {
  async index() { /* ... */ }
  async show({ params }: any) { /* ... */ }
}
```

2. 在 `start/routes.ts` 注册路由:

```typescript
router.get('/api/custom', [CustomController, 'index'])
router.get('/api/custom/:id', [CustomController, 'show'])
```

### 8.5 添加新的数据库表

在 `trend_bot.ts` 的 `initializeDatabase()` 函数中添加:

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS my_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field1 TEXT NOT NULL,
    field2 REAL DEFAULT 0
  )
`)
```

### 8.6 调试技巧

1. **查看调试日志**:

```bash
# 访问 /api/debug 接口
curl http://localhost:3000/api/debug
```

2. **查看数据库**:

```bash
# 使用 SQLite CLI
sqlite3 data/trading.db

# 查看表结构
.schema trades

# 查询数据
SELECT * FROM trades ORDER BY timestamp DESC LIMIT 10;
```

3. **日志级别**:

| 级别 | 说明 |
|------|------|
| INFO | 常规信息 |
| WARN | 警告信息 |
| ERROR | 错误信息 |
| SUCCESS | 成功操作 |

---

## 9. 部署说明

### 9.1 生产环境

1. **使用 PM2 进程管理器**:

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start bin/server.ts --name "fortune-dashboard"

# 启动趋势机器人
pm2 start commands/trend_bot_command.ts --name "fortune-trend"

# 开机自启
pm2 save
pm2 startup
```

2. **环境变量配置**:

```env
NODE_ENV=production
GATE_TESTNET_API_KEY=xxx
GATE_TESTNET_API_SECRET=xxx
PORT=3000
```

### 9.2 Docker 部署 (可选)

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm install -g tsx

EXPOSE 3000
CMD ["npm", "run", "dev"]
```

### 9.3 安全建议

1. **API 密钥保护**: 不要将密钥提交到 Git
2. **防火墙**: 只开放必要端口 (3000)
3. **定期备份**: 定期备份 `data/trading.db`
4. **监控告警**: 配置机器人状态监控

### 9.4 注意事项

- 本项目使用 **Gate.io 测试网**，不会产生真实资金
- 交易有风险，请在充分测试后使用
- 建议先在测试网验证策略再投入真实资金

---

## 附录

### A. npm 脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run trend:bot` | 启动趋势交易机器人 |
| `npm run grid:bot` | 启动网格交易机器人 |
| `npm run arbitrage:bot` | 启动套利机器人 |
| `npm run reset:data` | 重置所有数据 |

### B. 相关链接

- [AdonisJS 文档](https://docs.adonisjs.com/)
- [Gate.io API 文档](https://www.gate.io/docs/developers/apiv4/en/)
- [TypeScript 文档](https://www.typescriptlang.org/docs/)

### C. 许可证

MIT License

---

## 10. 常见问题

### 10.1 环境配置问题

**Q: npm install 失败？**

确保 Node.js 版本 >= 22.0.0：
```bash
node -v  # 确认版本
```

**Q: 找不到 .env 文件？**

```bash
cp .env.example .env
```

**Q: API 密钥无效？**

1. 确认使用的是 Gate.io **测试网** API（不是正式网）
2. 访问 https://testnet.gateio.pro 注册
3. 确保 API 密钥有永续合约交易权限

### 10.2 运行问题

**Q: Dashboard 无法访问？**

```bash
# 确认服务器已启动
npm run dev

# 检查端口占用
netstat -an | grep 3000
```

**Q: 机器人无法下单？**

1. 检查 API 密钥权限
2. 确认测试网余额充足
3. 查看 `/api/debug` 日志

**Q: 交易信号正常但不下单？**

检查以下条件：
- 余额是否充足
- 是否在交易冷却期内
- 当前是否有持仓

### 10.3 策略问题

**Q: 趋势策略信号不准？**

调整参数：
- `rsiOversold`: 降低超卖阈值（如 30）
- `rsiOverbought`: 升高超买阈值（如 75）
- `signalStrong`: 提高信号强度要求

**Q: 网格策略频繁止损？**

调整参数：
- 增加 `priceRangePercent` 扩大区间
- 减小 `stopLossPercent` 放宽止损
- 减少 `gridCount` 降低密度

**Q: DCA 加仓效果不佳？**

- 减小 `dcaAddPercent`（如 -1%）更频繁加仓
- 增大 `dcaCooldownMinutes` 避免过度加仓
- 限制 `dcaMaxPositions` 控制风险

### 10.4 数据库问题

**Q: 数据库文件损坏？**

```bash
# 删除旧数据库
rm data/trading.db

# 重置数据
npm run reset:data
```

**Q: 如何查看数据库内容？**

```bash
# 使用 SQLite 命令行
sqlite3 data/trading.db

# 查看所有表
.tables

# 查看交易记录
SELECT * FROM trades ORDER BY timestamp DESC LIMIT 10;

# 退出
.exit
```

### 10.5 性能问题

**Q: 机器人运行卡顿？**

1. 检查网络延迟
2. 减少 `checkInterval` 检查频率
3. 清理旧的 debug_logs

### 10.6 其他问题

**Q: 如何切换交易策略？**

通过 API：
```bash
# 获取当前策略
curl http://localhost:3000/api/strategy

# 切换策略
curl -X PUT http://localhost:3000/api/strategy \
  -H "Content-Type: application/json" \
  -d '{"strategy":"grid"}'
```

**Q: 如何调整杠杆？**

通过 API：
```bash
curl -X PUT http://localhost:3000/api/trading-settings \
  -H "Content-Type: application/json" \
  -d '{"leverage":10}'
```

**Q: 遇到未列出的问题？**

1. 查看 `/api/debug` 接口日志
2. 检查 `data/trading.db` 中的 `debug_logs` 表
3. 提交 Issue 到 GitHub
