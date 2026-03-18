/**
 * 全自动趋势交易机器人 V2
 * 优化版本: RSI阈值 + 趋势过滤 + 量价确认 + 移动止盈
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');

// ============ 数据库初始化 ============
const DB_PATH = path.join(__dirname, 'trading.db');
const db = new Database(DB_PATH);

// 创建检查日志表
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
`);

// 插入检查日志
function logCheck(data) {
  const stmt = db.prepare(`
    INSERT INTO check_logs (
      timestamp, price, position_size, position_entry_price,
      balance_total, balance_available, rsi, ma10, ma20, ma50,
      macd_hist, trend, volume_ok, signal_buy, signal_sell,
      signal_strength, signal_reason, action, action_amount, action_price, pnl_percent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    new Date().toISOString(),
    data.price,
    data.positionSize,
    data.positionEntryPrice,
    data.balanceTotal,
    data.balanceAvailable,
    data.rsi,
    data.ma10,
    data.ma20,
    data.ma50,
    data.macdHist,
    data.trend,
    data.volumeOk ? 1 : 0,
    data.signalBuy ? 1 : 0,
    data.signalSell ? 1 : 0,
    data.signalStrength,
    data.signalReason,
    data.action,
    data.actionAmount,
    data.actionPrice,
    data.pnlPercent
  );
}

// 状态文件路径
const STATUS_FILE = path.join(__dirname, 'bot-status.json');
const TRADE_FILE = path.join(__dirname, 'trade-status.json');
const API_PORT = 3000;

// ============ 内置状态API ============
function startStatusAPI() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.url === '/status' || req.url === '/') {
      const botStatus = getBotStatus();
      const tradeStatus = getTradeStatus();
      res.end(JSON.stringify({
        success: true,
        bot: 'trend-bot',
        status: botStatus.status,
        timestamp: botStatus.timestamp,
        price: tradeStatus?.price || null,
        position: tradeStatus?.position || null,
        balance: tradeStatus?.balance || null,
        pnl: tradeStatus?.pnl || null,
        signals: tradeStatus?.signals || null
      }));
    } else if (req.url === '/health') {
      res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    } else if (req.url === '/api') {
      const tradeStatus = getTradeStatus();
      res.end(JSON.stringify({
        price: tradeStatus?.price || 0,
        position: tradeStatus?.position || 0,
        balance: tradeStatus?.balance || 0,
        pnl: tradeStatus?.pnl || 0,
        status: getBotStatus().status
      }));
    } else if (req.url.startsWith('/logs')) {
      // 获取检查日志
      try {
        const limit = parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 50;
        const logs = db.prepare('SELECT * FROM check_logs ORDER BY id DESC LIMIT ?').all(limit);
        res.end(JSON.stringify({ success: true, logs }));
      } catch (e) {
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    } else if (req.url.startsWith('/stats')) {
      // 获取统计信息
      try {
        const total = db.prepare('SELECT COUNT(*) as count FROM check_logs').get().count;
        const trades = db.prepare("SELECT COUNT(*) as count FROM check_logs WHERE action != 'none'").get().count;
        const lastCheck = db.prepare('SELECT timestamp, price, signal_buy, signal_sell FROM check_logs ORDER BY id DESC LIMIT 1').get();
        res.end(JSON.stringify({ 
          success: true, 
          totalChecks: total,
          totalTrades: trades,
          lastCheck: lastCheck
        }));
      } catch (e) {
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  
  server.listen(API_PORT, '0.0.0.0', () => {
    console.log(`✅ 状态API: http://localhost:${API_PORT}/status`);
  });
  
  server.on('error', (e) => {
    console.error(`API错误: ${e.message}`);
  });
}

function getBotStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { status: 'offline', timestamp: Date.now() };
}

function getTradeStatus() {
  try {
    if (fs.existsSync(TRADE_FILE)) {
      return JSON.parse(fs.readFileSync(TRADE_FILE, 'utf8'));
    }
  } catch (e) {}
  // 从数据库获取最新状态
  try {
    const latest = db.prepare('SELECT * FROM check_logs ORDER BY id DESC LIMIT 1').get();
    if (latest) {
      return {
        price: latest.price,
        position: latest.position_size,
        balance: latest.balance_total,
        pnl: latest.pnl_percent,
        signals: {
          buy: latest.signal_buy === 1,
          sell: latest.signal_sell === 1,
          strength: latest.signal_strength,
          reason: latest.signal_reason
        }
      };
    }
  } catch (e) {}
  return null;
}

// 启动API
startStatusAPI();

// ============ 配置 ============
const CONFIG = {
  symbol: 'BTC_USDT',
  coin: 'bitcoin',           // market-data 用的 ID
  intervals: ['15m', '1h'],  // 多周期确认
  
  // 交易参数
  baseTradeAmount: 5,        // 每次建仓数量 (BTC)
  maxPositions: 3,           // 最多3批建仓
  positionScale: 1.5,        // 每批仓位递增1.5倍
  mode: 'live',              // live = 测试网真实交易
  
  // 止盈止损
  takeProfitPercent: 3,      // +3% 止盈
  stopLossPercent: 2,        // -2% 止损
  
  // 技术指标参数
  maShort: 10,               // MA10
  maLong: 20,                // MA20
  ma50: 50,                  // MA50
  rsiPeriod: 14,
  rsiOversold: 40,           // RSI < 40 超卖 (从30提高到40)
  rsiOverbought: 70,         // RSI > 70 超买
  
  // MACD 参数
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  
  // 趋势过滤
  trendFilter: true,
  trendMAperiod: 20,
  
  // 量价确认
  volumeConfirm: true,
  volumeThreshold: 1.2,     // 成交量放大1.2倍
  
  // 移动止盈
  trailingStop: true,
  trailingPercent: 1.5,
  
  // 检查间隔 (智能调整)
  checkIntervalWithPosition: 30 * 1000,   // 有持仓: 30秒
  checkIntervalWithoutPosition: 5 * 60 * 1000,  // 无持仓: 5分钟
  
  // 信号确认
  confirmRequired: 1,        // 只需要1次信号就执行 (分批建仓)
  cooldownMinutes: 15        // 交易后冷却15分钟
};

// 写入机器人状态
function writeBotStatus(status) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({
      status,
      timestamp: Date.now(),
      symbol: CONFIG.symbol
    }));
  } catch (e) {
    console.error('写入状态失败:', e.message);
  }
}

// 当前检查间隔 (动态)
let checkInterval = CONFIG.checkIntervalWithoutPosition;

// ============ 状态跟踪 ============
let signalHistory = {
  buyCount: 0,      // 连续买入信号次数
  sellCount: 0,     // 连续卖出信号次数
  lastTradeTime: 0, // 上次交易时间
  highestPrice: 0   // 持仓期间最高价 (用于移动止盈)
};

function canTrade() {
  // 检查冷却时间
  const now = Date.now();
  const cooldownMs = CONFIG.cooldownMinutes * 60 * 1000;
  if (now - signalHistory.lastTradeTime < cooldownMs) {
    const remaining = Math.round((cooldownMs - (now - signalHistory.lastTradeTime)) / 60000);
    log(`⏳ 冷却中，还需等待 ${remaining} 分钟`);
    return false;
  }
  return true;
}

function recordTrade(entryPrice) {
  signalHistory.lastTradeTime = Date.now();
  signalHistory.highestPrice = entryPrice;
  // 重置信号计数
  signalHistory.buyCount = 0;
  signalHistory.sellCount = 0;
}

function updateHighestPrice(price) {
  if (price > signalHistory.highestPrice) {
    signalHistory.highestPrice = price;
  }
}

// ============ Gate.io API ============
const GateApi = require('gate-api');
const { gateio } = require('./secrets');
const apiClient = new GateApi.ApiClient();
apiClient.basePath = gateio.basePath;
apiClient.setApiKeySecret(gateio.apiKey, gateio.apiSecret);
const futuresApi = new GateApi.FuturesApi(apiClient);
const spotApi = new GateApi.SpotApi(apiClient);

// ============ 工具函数 ============
function log(msg) {
  console.log(`[${new Date().toLocaleString()}] ${msg}`);
}

function exec(cmd) {
  return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 20000 }));
}

// 同步 HTTP GET 请求
function httpGet(url, timeout = 10000) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// 获取K线数据 (直接从 Gate.io API 获取)
async function getOHLC(coin, days = 7, interval = '1h') {
  // 将 coin 转换为交易对格式
  let pair;
  if (coin.includes('_')) {
    pair = coin;
  } else {
    // 常见币种映射
    const coinMap = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'solana': 'SOL',
      'ripple': 'XRP',
      'cardano': 'ADA',
      'dogecoin': 'DOGE'
    };
    const base = coinMap[coin.toLowerCase()] || coin.toUpperCase();
    pair = `${base}_USDT`;
  }
  
  // Gate.io interval: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w
  const intervalMap = { '1h': '1h', '4h': '4h', '1d': '1d', '15m': '15m', '5m': '5m', '1m': '1m' };
  const sec = intervalMap[interval] || '1h';

  const now = Math.floor(Date.now() / 1000);
  const from = now - (days * 24 * 60 * 60);

  try {
    const data = await httpGet(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${sec}&from=${from}&to=${now}`);
    let result = JSON.parse(data);
    // Gate.io 可能返回 { data: [...] } 或直接是数组
    if (result && result.data) result = result.data;
    if (!Array.isArray(result)) {
      log(`⚠️ K线数据格式错误: ${JSON.stringify(result).slice(0,100)}`);
      return [];
    }
    // Gate.io 返回格式: [[timestamp, volume, close, high, low, open], ...]
    return result.map(d => ({
      time: d[0],
      volume: parseFloat(d[1]),
      close: parseFloat(d[2]),
      high: parseFloat(d[3]),
      low: parseFloat(d[4]),
      open: parseFloat(d[5])
    }));
  } catch (e) {
    log(`⚠️ 获取K线失败: ${e.message}`);
    return [];
  }
}

// 获取当前价格 (直接从 Gate.io API 获取)
async function getCurrentPrice(coin) {
  // 将 coin 转换为交易对格式
  let pair;
  if (coin.includes('_')) {
    pair = coin;
  } else {
    const coinMap = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'solana': 'SOL',
      'ripple': 'XRP',
      'cardano': 'ADA',
      'dogecoin': 'DOGE'
    };
    const base = coinMap[coin.toLowerCase()] || coin.toUpperCase();
    pair = `${base}_USDT`;
  }
  
  try {
    const data = await httpGet(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`);
    const result = JSON.parse(data);
    if (result && result[0] && result[0].last) {
      return parseFloat(result[0].last);
    }
  } catch (e) {
    log(`⚠️ 获取价格失败: ${e.message}`);
  }
  return null;
}

// 计算简单移动平均
function calculateMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      result.push(sum / period);
    }
  }
  return result;
}

// 计算RSI
function calculateRSI(data, period = 14) {
  const result = [];
  let gains = 0, losses = 0;
  
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    
    if (i <= period) {
      gains += gain;
      losses += loss;
      result.push(null);
      if (i === period) {
        const rs = losses === 0 ? 100 : gains / losses;
        result[i] = 100 - (100 / (1 + rs));
      }
    } else {
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
      const rs = losses === 0 ? 100 : gains / losses;
      result.push(100 - (100 / (1 + rs)));
    }
  }
  
  return result;
}

// 计算MACD
function calculateMACD(data, fast = 12, slow = 26, signal = 9) {
  // 计算EMA
  function calcEMA(period) {
    const result = [];
    let ema = null;
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
        continue;
      }
      if (ema === null) {
        // 初始SMA
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        ema = sum / period;
      } else {
        ema = (data[i].close - ema) * (2 / (period + 1)) + ema;
      }
      result.push(ema);
    }
    return result;
  }
  
  const emaFast = calcEMA(fast);
  const emaSlow = calcEMA(slow);
  const macdLine = [];
  const signalLine = [];
  const histogram = [];
  
  for (let i = 0; i < data.length; i++) {
    if (emaFast[i] === null || emaSlow[i] === null) {
      macdLine.push(null);
      signalLine.push(null);
      histogram.push(null);
      continue;
    }
    const macd = emaFast[i] - emaSlow[i];
    macdLine.push(macd);
    
    // Signal线EMA
    if (i < slow + signal - 2) {
      signalLine.push(null);
      histogram.push(null);
    } else {
      const prevSignal = signalLine[i - 1];
      if (prevSignal === null) {
        // 初始信号线SMA
        let sum = 0;
        let count = 0;
        for (let j = 0; j < signal && i - j >= 0; j++) {
          if (macdLine[i - j] !== null) {
            sum += macdLine[i - j];
            count++;
          }
        }
        const sig = count > 0 ? sum / count : null;
        signalLine.push(sig);
        if (sig !== null) histogram.push(macd - sig);
      } else {
        const sig = (macd - prevSignal) * (2 / (signal + 1)) + prevSignal;
        signalLine.push(sig);
        histogram.push(macd - sig);
      }
    }
  }
  
  return { macd: macdLine, signal: signalLine, histogram };
}

// 计算成交量均线判断放量 (新增)
function isVolumeExpanding(data, threshold = 1.5) {
  if (data.length < 5) return true;
  
  // 最近2根K线平均成交量
  const recentVolume = (data[data.length - 1].volume + data[data.length - 2].volume) / 2;
  // 之前5根K线平均成交量
  let pastVolume = 0;
  for (let i = 3; i < 8 && i < data.length; i++) {
    pastVolume += data[data.length - i].volume;
  }
  pastVolume /= 5;
  
  if (pastVolume === 0) return true;
  return recentVolume / pastVolume >= threshold;
}

// 获取当前价格
function getCurrentPrice(coin) {
  const data = exec(`node ../skills/crypto-market-data/scripts/get_crypto_price.js ${coin}`);
  return data[coin]?.usd;
}

// 获取账户余额 (带重试)
async function getBalance() {
  for (let i = 0; i < 3; i++) {
    try {
      const result = await futuresApi.listFuturesAccounts('usdt');
      const data = result.body;
      return {
        total: parseFloat(data.total || 0),
        available: parseFloat(data.available || 0),
        unrealisedPnl: parseFloat(data.unrealisedPnl || 0)
      };
    } catch (e) {
      log(`⚠️ 获取余额失败 (${i+1}/3): ${e.message}`);
      if (i < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// 获取持仓 (带重试)
async function getPosition() {
  for (let i = 0; i < 3; i++) {
    try {
      const result = await futuresApi.listPositions('usdt');
      const positions = result.body;
      const pos = positions.find(p => p.contract === CONFIG.symbol && p.size && parseFloat(p.size) !== 0);
      if (pos) {
        return {
          size: parseFloat(pos.size),
          entryPrice: parseFloat(pos.entryPrice || pos.price),
          unrealizedPnl: parseFloat(pos.unrealisedPnl || pos.profit)
        };
      }
      return null;
    } catch (e) {
      log(`⚠️ 获取持仓失败 (${i+1}/3): ${e.message}`);
      if (i < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// 获取当前市场价格
async function getMarkPrice() {
  try {
    const positions = await futuresApi.listPositions('usdt');
    const pos = positions.body.find(p => p.contract === CONFIG.symbol);
    return pos ? parseFloat(pos.markPrice) : null;
  } catch (e) {
    return null;
  }
}

// 开多仓 + 自动挂止盈止损
async function openLong(price, amount) {
  try {
    // 使用市价单开仓，避免价格偏差问题
    const order = {
      contract: CONFIG.symbol,
      size: amount.toString(),  // 正数 = 多
      price: '0',  // 市价单
      tif: 'ioc'
    };
    const result = await futuresApi.createFuturesOrder('usdt', order);
    
    // 获取实际成交价格
    const fillPrice = result.body.fillPrice || price;
    log(`✅ 开多仓成功: ${amount} BTC @ ${fillPrice}`);
    
    // 获取当前市场价格
    const markPrice = await getMarkPrice() || parseFloat(fillPrice);
    
    // 计算止盈止损价格 (基于markPrice)，多留1%缓冲避免超过2%限制
    const takeProfitPrice = markPrice * (1 + CONFIG.takeProfitPercent / 100 * 0.99);
    const stopLossPrice = markPrice * (1 - CONFIG.stopLossPercent / 100 * 0.99);
    
    // 检查价格是否在±2%范围内，不在则调整
    const maxDeviation = markPrice * 0.02;
    // 止盈不能超过现价+2%
    const tpFinal = Math.min(takeProfitPrice, markPrice + maxDeviation);
    // 止损不能低于现价-2%
    const slFinal = Math.max(stopLossPrice, markPrice - maxDeviation);
    
    // 挂止盈单 (价格达到止盈价时卖出)
    const tpOrder = {
      contract: CONFIG.symbol,
      size: (-amount).toString(),  // 负数 = 平仓
      price: Math.floor(tpFinal).toString(),
      tif: 'gtc'
    };
    await futuresApi.createFuturesOrder('usdt', tpOrder);
    log(`✅ 止盈单已挂: ${Math.floor(tpFinal)} (+${CONFIG.takeProfitPercent}%)`);
    
    // 挂止损单 (价格达到止损价时卖出)
    const slOrder = {
      contract: CONFIG.symbol,
      size: (-amount).toString(),
      price: Math.floor(slFinal).toString(),
      tif: 'gtc'
    };
    await futuresApi.createFuturesOrder('usdt', slOrder);
    log(`✅ 止损单已挂: ${Math.floor(slFinal)} (-${CONFIG.stopLossPercent}%)`);
    
    return result;
  } catch (e) {
    log(`❌ 开多仓失败: ${e.message}`);
    return null;
  }
}

// 平多仓
async function closeLong(price, amount) {
  try {
    // 使用市价单平仓
    const order = {
      contract: CONFIG.symbol,
      size: (-amount).toString(),  // 负数 = 平
      price: '0',
      tif: 'ioc'
    };
    const result = await futuresApi.createFuturesOrder('usdt', order);
    const fillPrice = result.body.fillPrice || price;
    log(`✅ 平多仓成功: ${amount} BTC @ ${fillPrice}`);
    return result;
  } catch (e) {
    log(`❌ 平多仓失败: ${e.message}`);
    return null;
  }
}

// 开空仓 (新增)
async function openShort(price, amount) {
  try {
    // 使用市价单开仓
    const order = {
      contract: CONFIG.symbol,
      size: (-amount).toString(),  // 负数 = 空
      price: '0',  // 市价单
      tif: 'ioc'
    };
    const result = await futuresApi.createFuturesOrder('usdt', order);
    
    // 获取实际成交价格
    const fillPrice = result.body.fillPrice || price;
    log(`✅ 开空仓成功: ${amount} BTC @ ${fillPrice}`);
    
    // 获取当前市场价格
    const markPrice = await getMarkPrice() || parseFloat(fillPrice);
    
    // 计算止盈止损价格 (基于markPrice)，多留1%缓冲
    const takeProfitPrice = markPrice * (1 - CONFIG.takeProfitPercent / 100 * 0.99);
    const stopLossPrice = markPrice * (1 + CONFIG.stopLossPercent / 100 * 0.99);
    
    // 检查价格是否在±2%范围内
    const maxDeviation = markPrice * 0.02;
    // 止盈不能低于现价-2%
    const tpFinal = Math.max(takeProfitPrice, markPrice - maxDeviation);
    // 止损不能超过现价+2%
    const slFinal = Math.min(stopLossPrice, markPrice + maxDeviation);
    
    // 挂止盈单 (价格下跌时买入平仓)
    const tpOrder = {
      contract: CONFIG.symbol,
      size: amount.toString(),  // 正数 = 平空
      price: Math.ceil(tpFinal).toString(),
      tif: 'gtc'
    };
    await futuresApi.createFuturesOrder('usdt', tpOrder);
    log(`✅ 止盈单已挂: ${Math.ceil(tpFinal)} (+${CONFIG.takeProfitPercent}%)`);
    
    // 挂止损单 (价格上涨时买入平仓)
    const slOrder = {
      contract: CONFIG.symbol,
      size: amount.toString(),
      price: Math.ceil(slFinal).toString(),
      tif: 'gtc'
    };
    await futuresApi.createFuturesOrder('usdt', slOrder);
    log(`✅ 止损单已挂: ${Math.ceil(slFinal)} (-${CONFIG.stopLossPercent}%)`);
    
    return result;
  } catch (e) {
    log(`❌ 开空仓失败: ${e.message}`);
    return null;
  }
}

// 平空仓 (新增)
async function closeShort(price, amount) {
  try {
    const order = {
      contract: CONFIG.symbol,
      size: amount.toString(),  // 正数 = 平空
      price: '0',
      tif: 'ioc'
    };
    const result = await futuresApi.createFuturesOrder('usdt', order);
    const fillPrice = result.body.fillPrice || price;
    log(`✅ 平空仓成功: ${amount} BTC @ ${fillPrice}`);
    return result;
  } catch (e) {
    log(`❌ 平空仓失败: ${e.message}`);
    return null;
  }
}

// ============ 交易策略 V2 ============
// 优化版本: 多指标 + 趋势过滤 + 量价确认 + 分批建仓

// 获取持仓数量 (分批建仓用)
async function getPositionCount() {
  const position = await getPosition();
  if (!position || position.size === 0) return 0;
  return 1; // 简化：目前只记录是否有持仓
}

// 分析信号 (异步)
async function analyzeSignals(ohlc1h, currentPrice) {
  const signals = {
    buy: false,
    sell: false,
    short: false,
    reason: [],
    strength: 0,  // 信号强度 0-5
    // 技术指标数据 (用于日志)
    rsi: null,
    ma10: null,
    ma20: null,
    ma50: null,
    macdHist: null,
    trendUp: false,
    volumeOK: true
  };
  
  // 计算指标
  const rsi_1h = calculateRSI(ohlc1h, CONFIG.rsiPeriod);
  const rsi = rsi_1h[rsi_1h.length - 1];
  signals.rsi = rsi;
  
  const ma10 = calculateMA(ohlc1h, CONFIG.maShort);
  const ma20 = calculateMA(ohlc1h, CONFIG.maLong);
  const ma50 = calculateMA(ohlc1h, CONFIG.ma50);
  
  const ma10_latest = ma10[ma10.length - 1];
  const ma20_latest = ma20[ma20.length - 1];
  const ma50_latest = ma50[ma50.length - 1];
  signals.ma10 = ma10_latest;
  signals.ma20 = ma20_latest;
  signals.ma50 = ma50_latest;
  
  // MACD
  const macd = calculateMACD(ohlc1h, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);
  const macdLine = macd.macd[macd.macd.length - 1];
  const macdSignal = macd.signal[macd.signal.length - 1];
  const macdHist = macd.histogram[macd.histogram.length - 1];
  const macdPrev = macd.histogram[macd.histogram.length - 2];
  signals.macdHist = macdHist;
  
  // 前一根K线
  const prevClose = ohlc1h[ohlc1h.length - 2].close;
  const priceChange = (currentPrice - prevClose) / prevClose * 100;
  
  log(`📊 RSI: ${rsi?.toFixed(2)} (超卖<${CONFIG.rsiOversold})`);
  log(`📊 MA10: ${ma10_latest?.toFixed(2)}, MA20: ${ma20_latest?.toFixed(2)}, MA50: ${ma50_latest?.toFixed(2)}`);
  log(`📊 MACD: ${macdLine?.toFixed(2)}, Signal: ${macdSignal?.toFixed(2)}, Hist: ${macdHist?.toFixed(2)}`);
  
  // 趋势判断
  let trendUp = false;
  if (CONFIG.trendFilter) {
    try {
      const ohlc1d = await getOHLC(CONFIG.coin, 30, '1d');
      const ma20_1d = calculateMA(ohlc1d, CONFIG.trendMAperiod);
      const ma20_daily = ma20_1d[ma20_1d.length - 1];
      const ma20_daily_prev = ma20_1d[ma20_1d.length - 2];
      trendUp = ma20_daily > ma20_daily_prev;
      log(`📈 日线趋势: ${trendUp ? '上升↗️' : '下降↘️'}`);
    } catch (e) {
      trendUp = true;
    }
  } else {
    trendUp = true;
  }
  signals.trendUp = trendUp;
  
  // 量价确认
  let volumeOK = true;
  if (CONFIG.volumeConfirm) {
    volumeOK = isVolumeExpanding(ohlc1h, CONFIG.volumeThreshold);
    log(`📊 成交量: ${volumeOK ? '放大✅' : '缩量❌'}`);
  }
  signals.volumeOK = volumeOK;
  
  // ====== 多重买入信号 ======
  // 1. RSI超卖 (40以下)
  if (rsi < CONFIG.rsiOversold) {
    signals.buy = true;
    signals.reason.push(`RSI超卖(${rsi.toFixed(0)}<${CONFIG.rsiOversold})`);
    signals.strength += 2;
  }
  
  // 2. 金叉 (MA10上穿MA20)
  if (ma10_latest > ma20_latest) {
    signals.reason.push('MA金叉');
    signals.strength += 1;
  }
  
  // 3. RSI低位回升 (从30以下回升)
  const rsiPrev = rsi_1h[rsi_1h.length - 2];
  if (rsi < 50 && rsi > rsiPrev && rsiPrev < 40) {
    signals.buy = true;
    signals.reason.push('RSI低位回升');
    signals.strength += 2;
  }
  
  // 4. MACD金叉 (histogram从负转正)
  if (macdHist > 0 && macdPrev < 0) {
    signals.buy = true;
    signals.reason.push('MACD金叉');
    signals.strength += 2;
  }
  
  // 5. MACD多头排列
  if (macdLine > macdSignal && macdSignal > 0) {
    signals.reason.push('MACD多头');
    signals.strength += 1;
  }
  
  // 6. 价格突破MA20
  if (currentPrice > ma20_latest && prevClose < ma20_latest) {
    signals.buy = true;
    signals.reason.push('突破MA20');
    signals.strength += 1;
  }
  
  // 7. 价格突破MA50
  if (currentPrice > ma50_latest) {
    signals.reason.push('突破MA50');
    signals.strength += 1;
  }
  
  // 8. 放量上涨
  if (volumeOK && priceChange > 0.5) {
    signals.reason.push('放量上涨');
    signals.strength += 1;
  }
  
  // 9. 趋势向上 + RSI不过高
  if (trendUp && rsi < 60) {
    signals.reason.push('趋势向上');
    signals.strength += 1;
  }
  
  // 综合判断：至少满足2个条件或强度>=3
  if (signals.strength >= 3 || (signals.reason.length >= 2 && rsi < 55)) {
    signals.buy = true;
  }
  
  // ====== 卖出/做空信号 ======
  // RSI超买
  if (rsi > CONFIG.rsiOverbought) {
    signals.sell = true;
    signals.reason.push(`RSI超买(${rsi.toFixed(0)}>${CONFIG.rsiOverbought})`);
  }
  
  // 死叉
  if (ma10_latest < ma20_latest && rsi > 50) {
    signals.sell = true;
    signals.reason.push('MA死叉');
  }
  
  // MACD死叉
  if (macdHist < 0 && macdPrev > 0) {
    signals.sell = true;
    signals.reason.push('MACD死叉');
  }
  
  return signals;
}

// ============ 主循环 ============
async function tradeCycle() {
  log('='.repeat(50));
  log('🔄 开始交易检查...');
  
  // 用于日志记录
  let currentPrice = null;
  let balance = null;
  let position = null;
  let signals = null;
  
  try {
    // 1. 获取数据
    currentPrice = await getCurrentPrice(CONFIG.coin);
    const ohlc1h = await getOHLC(CONFIG.coin, 14);    // 14天1小时K线 (足够MA50)
    
    if (!currentPrice) {
      log('❌ 无法获取价格，跳过');
      return;
    }
    
    log(`💰 当前价格: $${currentPrice.toLocaleString()}`);
    
    // 2. 获取账户状态
    [balance, position] = await Promise.all([
      getBalance(),
      getPosition()
    ]);
    
    if (balance) {
      log(`💰 账户: 总资产 ${balance.total.toFixed(2)} USDT, 可用 ${balance.available.toFixed(2)} USDT`);
    }
    
    // 3. 分析信号
    signals = await analyzeSignals(ohlc1h, currentPrice);
    
    // 4. 检查止盈止损 (多仓)
    if (position && position.size > 0) {
      const pnlPercent = (currentPrice - position.entryPrice) / position.entryPrice * 100;
      log(`📋 多仓: ${position.size} BTC @ $${position.entryPrice.toLocaleString()}, 盈亏: ${pnlPercent.toFixed(2)}%`);
      
      // 更新最高价 (用于移动止盈)
      updateHighestPrice(currentPrice);
      
      // 固定止盈
      if (pnlPercent >= CONFIG.takeProfitPercent) {
        log(`🎯 触发固定止盈: ${pnlPercent.toFixed(2)}% >= ${CONFIG.takeProfitPercent}%`);
        await closeLong(currentPrice, position.size);
        lastAction = 'close_long_tp';
        lastActionAmount = position.size;
        lastActionPrice = currentPrice;
        return;
      }
      
      // 止损
      if (pnlPercent <= -CONFIG.stopLossPercent) {
        log(`🛑 触发止损: ${pnlPercent.toFixed(2)}% <= -${CONFIG.stopLossPercent}%`);
        await closeLong(currentPrice, position.size);
        lastAction = 'close_long_sl';
        lastActionAmount = position.size;
        lastActionPrice = currentPrice;
        return;
      }
      
      // 移动止盈
      if (CONFIG.trailingStop && signalHistory.highestPrice > 0) {
        const highProfitPercent = (signalHistory.highestPrice - position.entryPrice) / position.entryPrice * 100;
        const currentProfitPercent = (currentPrice - position.entryPrice) / position.entryPrice * 100;
        
        if (highProfitPercent >= 3 && currentProfitPercent <= (highProfitPercent - CONFIG.trailingPercent)) {
          log(`🐢 触发移动止盈: 最高${highProfitPercent.toFixed(2)}%, 现在${currentProfitPercent.toFixed(2)}%`);
          await closeLong(currentPrice, position.size);
          lastAction = 'close_long_trailing';
          lastActionAmount = position.size;
          lastActionPrice = currentPrice;
          return;
        }
      }
    }
    
    // 4b. 检查止盈止损 (空仓)
    if (position && position.size < 0) {
      const posSize = Math.abs(position.size);
      const pnlPercent = (position.entryPrice - currentPrice) / position.entryPrice * 100;
      log(`📋 空仓: ${posSize} BTC @ $${position.entryPrice.toLocaleString()}, 盈亏: ${pnlPercent.toFixed(2)}%`);
      
      // 固定止盈
      if (pnlPercent >= CONFIG.takeProfitPercent) {
        log(`🎯 空仓止盈: ${pnlPercent.toFixed(2)}%`);
        await closeShort(currentPrice, posSize);
        lastAction = 'close_short_tp';
        lastActionAmount = posSize;
        lastActionPrice = currentPrice;
        return;
      }
      
      // 止损
      if (pnlPercent <= -CONFIG.stopLossPercent) {
        log(`🛑 空仓止损: ${pnlPercent.toFixed(2)}%`);
        await closeShort(currentPrice, posSize);
        lastAction = 'close_short_sl';
        lastActionAmount = posSize;
        lastActionPrice = currentPrice;
        return;
      }
    }
    
    // 5. 分批建仓逻辑
    
    if (!position || position.size === 0) {
      // 无持仓，可以建仓
      const positionCount = 0; // 简化：每次都是首次建仓
      
      if (signals.buy) {
        // 计算建仓数量 (分批)
        let amount = CONFIG.baseTradeAmount;
        
        // 检查余额是否足够 (使用10%仓位)
        const maxAffordable = balance.available * 0.1 / (currentPrice / 10000); // 杠杆4倍
        amount = Math.min(amount, Math.floor(maxAffordable * 100) / 100);
        amount = Math.max(amount, 0.001); // 最小0.001 BTC
        
        if (amount >= 0.01) {
          log(`🚀 开多仓 (第${positionCount + 1}批): ${amount} BTC @ $${currentPrice.toLocaleString()}`);
          log(`📋 信号: ${signals.reason.join(' + ')} (强度: ${signals.strength})`);
          
          if (canTrade()) {
            await openLong(currentPrice, amount);
            recordTrade(currentPrice);
            lastAction = 'open_long';
            lastActionAmount = amount;
            lastActionPrice = currentPrice;
          }
        }
      } else {
        log('⏸️ 无买入信号，保持观望');
        log(`📋 原因: ${signals.reason.join(' + ') || '无明显信号'}`);
      }
    } else if (position.size > 0) {
      // 有多仓，检查是否加仓或平仓
      
      // 检查是否加仓 (价格下跌时补仓)
      const pnlPercent = (currentPrice - position.entryPrice) / position.entryPrice * 100;
      
      if (signals.buy && pnlPercent < 0 && pnlPercent > -5) {
        // 浮亏时，如果又有买入信号，可以加仓
        log(`📈 浮亏${pnlPercent.toFixed(2)}%，符合加仓条件`);
      }
      
      // 平仓信号
      if (signals.sell) {
        log(`🔻 平多仓: ${position.size} BTC @ $${currentPrice.toLocaleString()}`);
        log(`📋 原因: ${signals.reason.join(' + ')}`);
        
        if (canTrade()) {
          await closeLong(currentPrice, position.size);
          recordTrade(currentPrice);
          lastAction = 'close_long_signal';
          lastActionAmount = position.size;
          lastActionPrice = currentPrice;
        }
      } else {
        log(`📊 持仓中: ${position.size} BTC @ $${position.entryPrice.toLocaleString()}, 盈亏: ${pnlPercent.toFixed(2)}%`);
      }
    }
    
  } catch (e) {
    log(`❌ 交易循环错误: ${e.message}`);
  }
  
  // 记录检查日志
  try {
    // 计算持仓盈亏
    let pnlPercent = null;
    if (position && position.size !== 0 && currentPrice && position.entryPrice) {
      pnlPercent = (currentPrice - position.entryPrice) / position.entryPrice * 100;
    }
    
    logCheck({
      price: currentPrice,
      positionSize: position?.size || 0,
      positionEntryPrice: position?.entryPrice || null,
      balanceTotal: balance?.total || null,
      balanceAvailable: balance?.available || null,
      rsi: signals?.rsi || null,
      ma10: signals?.ma10 || null,
      ma20: signals?.ma20 || null,
      ma50: signals?.ma50 || null,
      macdHist: signals?.macdHist || null,
      trend: signals?.trendUp ? 'up' : 'down',
      volumeOk: signals?.volumeOK || false,
      signalBuy: signals?.buy || false,
      signalSell: signals?.sell || false,
      signalStrength: signals?.strength || 0,
      signalReason: signals?.reason?.join('; ') || '',
      action: lastAction,
      actionAmount: lastActionAmount,
      actionPrice: lastActionPrice,
      pnlPercent: pnlPercent
    });
  } catch (logErr) {
    log(`⚠️ 记录日志失败: ${logErr.message}`);
  }
  
  log('='.repeat(50));
}

// 记录上次操作 (用于日志)
let lastAction = 'none';
let lastActionAmount = null;
let lastActionPrice = null;

// 启动时写入状态
writeBotStatus('online');

// ============ 启动 ============
const isOnceMode = process.argv.includes('--once');

log('🤖 趋势交易机器人 V2 启动');
log(`📋 配置: ${CONFIG.symbol}`);
log(`📊 RSI: 超卖<${CONFIG.rsiOversold}, 超买>${CONFIG.rsiOverbought}`);
log(`📈 趋势过滤: ${CONFIG.trendFilter ? '开启' : '关闭'}`);
log(`📊 量价确认: ${CONFIG.volumeConfirm ? '开启' : '关闭'}`);
log(`🐢 移动止盈: ${CONFIG.trailingStop ? '开启' : '关闭'}`);
log(`💰 止盈${CONFIG.takeProfitPercent}%, 止损${CONFIG.stopLossPercent}%`);

if (isOnceMode) {
  log(`📝 模式: 单次汇报`);
  // 单次执行
  tradeCycle().then(() => process.exit(0));
} else {
  log(`⏰ 有持仓间隔: ${CONFIG.checkIntervalWithPosition / 1000}秒, 无持仓间隔: ${CONFIG.checkIntervalWithoutPosition / 60000}分钟`);
  
  // 智能间隔函数
  function getSmartInterval(position) {
    if (position && position.size !== 0) {
      return CONFIG.checkIntervalWithPosition;
    }
    return CONFIG.checkIntervalWithoutPosition;
  }
  
  // 立即执行一次
  tradeCycle();
  
  // 定时执行 (使用动态间隔)
  setInterval(async () => {
    // 更新状态
    writeBotStatus('online');
    
    // 先获取持仓状态
    const position = await getPosition();
    const interval = getSmartInterval(position);
    
    // 如果间隔变了，重新设置定时器
    if (interval !== checkInterval) {
      checkInterval = interval;
      log(`📊 检查间隔调整为: ${interval === CONFIG.checkIntervalWithPosition ? '30秒 (有持仓)' : '5分钟 (无持仓)'}`);
    }
    
    await tradeCycle();
  }, checkInterval);
}

// 进程退出时更新状态
process.on('exit', () => writeBotStatus('offline'));
process.on('SIGINT', () => { writeBotStatus('offline'); process.exit(); });
process.on('SIGTERM', () => { writeBotStatus('offline'); process.exit(); });
