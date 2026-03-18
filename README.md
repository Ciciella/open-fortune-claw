# 🍈 Open Fortune Claw - 加密货币交易机器人

> 自动化加密货币交易系统，支持趋势交易、网格交易等多种策略

## 功能特性

- 📊 **Dashboard** - 实时查看交易状态、持仓、盈亏
- 📈 **趋势交易** - 基于 RSI、MA、MACD 等指标自动交易
- 🔲 **网格交易** - 区间震荡自动低买高卖
- 🔄 **自动盯盘** - 7×24 小时自动执行交易策略

## 快速开始

### 1. 安装依赖

```bash
cd open-fortune-claw
npm install gate-api sqlite3
```

### 2. 配置 API

复制 `secrets.js` 模板并填入你的 Gate.io API 密钥：

```bash
cp secrets.js.example secrets.js
```

编辑 `secrets.js`，填入你的密钥：

```javascript
module.exports = {
  gateio: {
    apiKey: '你的API Key',
    apiSecret: '你的API Secret',
    basePath: 'https://api-testnet.gateapi.io/api/v4'
  }
};
```

### 3. 启动 Dashboard

```bash
node dashboard-api.js
```

访问 http://localhost:3000

### 4. 启动交易机器人

```bash
# 趋势交易
node trend-bot.js

# 网格交易
node grid-bot.js

# 资金费率套利
node arbitrage-bot.js
```

## 项目结构

```
open-fortune-claw/
├── index.html          # Dashboard 前端
├── dashboard-api.js   # Dashboard API 服务
├── trend-bot.js       # 趋势交易机器人
├── grid-bot.js        # 网格交易机器人
├── arbitrage-bot.js   # 资金费率套利
├── experiments/        # 实验性代码和可行性研究
├── secrets.js.example  # API 密钥模板
├── secrets.js         # API 密钥（已忽略，不提交）
├── trading.db         # 本地交易数据库（已忽略）
└── .gitignore         # Git 忽略配置
```

## 技术栈

- **后端**: Node.js
- **API**: Gate.io Futures API (测试网)
- **数据库**: SQLite
- **前端**: HTML + JavaScript

## 注意事项

- ⚠️ 当前使用 Gate.io **测试网**，不会产生真实资金
- 🔒 API 密钥通过 `secrets.js` 管理，已加入 `.gitignore`，请勿提交到 GitHub
- 📈 交易有风险，请谨慎使用

## License

MIT
