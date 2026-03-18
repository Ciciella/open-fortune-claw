/**
 * 交易Dashboard API服务器
 * 运行: node dashboard-api.js
 * 访问: http://localhost:3000/api/*
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PORT = 3000;

// 打开本地数据库
const db = new sqlite3.Database('trading.db');

// 读取本地交易记录
function getLocalTrades(callback) {
  db.all("SELECT * FROM trades ORDER BY timestamp DESC LIMIT 50", (err, rows) => {
    if (err) {
      console.log('⚠️ 本地交易记录读取失败:', err.message);
      callback([]);
    } else {
      callback(rows);
    }
  });
}

// 使用 gate-api SDK
const GateApi = require('gate-api');
const { gateio } = require('./secrets');

const API_KEY = gateio.apiKey;
const API_SECRET = gateio.apiSecret;

const client = new GateApi.ApiClient();
client.basePath = gateio.basePath;
client.setApiKeySecret(API_KEY, API_SECRET);

const futuresApi = new GateApi.FuturesApi(client);

// 缓存数据
let cache = {
  positions: [],
  balance: null,
  trades: [],
  lastUpdate: 0
};

async function fetchData() {
  try {
    // 获取持仓
    const positions = await futuresApi.listPositions('usdt');
    const posList = Array.isArray(positions.body) ? positions.body : [];
    
    cache.positions = posList.filter(p => parseFloat(p.size) !== 0).map(p => ({
      symbol: p.contract,
      side: parseFloat(p.size) > 0 ? 'long' : 'short',
      amount: Math.abs(parseFloat(p.size)),
      entry_price: parseFloat(p.entryPrice),
      current_price: parseFloat(p.markPrice),
      pnl: parseFloat(p.unrealisedPnl),
      leverage: p.leverage,
      updated_at: new Date().toISOString()
    }));
    
    // 获取账户余额
    const accounts = await futuresApi.listFuturesAccounts('usdt');
    cache.balance = {
      total: parseFloat(accounts.body.total),
      available: parseFloat(accounts.body.available),
      unrealisedPnl: parseFloat(accounts.body.unrealisedPnl)
    };
    
    // 获取历史成交 - 使用 listPositionClose
    // 从本地数据库获取交易记录
    getLocalTrades((localTrades) => {
      cache.trades = localTrades.map(t => ({
        id: t.id,
        type: t.type,
        side: t.side,
        amount: t.amount,
        price: t.price,
        strategy: t.strategy || 'trend-bot',
        reason: t.reason || '-',
        timestamp: t.timestamp,
        pnl: t.pnl || 0
      }));
      
      cache.lastUpdate = Date.now();
      console.log('✅ 数据更新:', new Date().toLocaleString(), '- 持仓:', cache.positions.length, '交易:', cache.trades.length);
    });
  } catch(e) {
    console.error('❌ 数据获取失败:', e.message);
  }
}

// 定时更新数据
setInterval(fetchData, 30000);
fetchData();

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  try {
    if (url === '/api/status') {
      // Bot状态
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: cache.lastUpdate > 0 ? 'online' : 'offline',
        bot: 'trend-bot',
        lastUpdate: cache.lastUpdate
      }));
      
    } else if (url === '/api/trades') {
      // 交易历史 + 持仓
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayTrades = cache.trades.filter(t => new Date(t.timestamp) >= today);
      const totalPnl = cache.balance?.unrealisedPnl || 0;
      const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        trades: cache.trades,
        positions: cache.positions,
        stats: {
          totalTrades: cache.trades.length,
          todayTrades: todayTrades.length,
          totalPnl: totalPnl,
          todayPnl: todayPnl
        }
      }));
      
    } else if (url === '/api/positions') {
      // 当前持仓
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        positions: cache.positions,
        balance: cache.balance
      }));
      
    } else if (url === '/api/all') {
      // 汇总数据
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        balance: cache.balance,
        positions: cache.positions,
        trades: cache.trades,
        lastUpdate: cache.lastUpdate
      }));
      
    } else if (url === '/api/logs') {
      // 检查日志
      const limit = parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 50;
      db.all('SELECT * FROM check_logs ORDER BY id DESC LIMIT ?', [limit], (err, rows) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, logs: rows }));
        }
      });
      return;
      
    } else if (url === '/api/stats') {
      // 统计信息
      db.get('SELECT COUNT(*) as count FROM check_logs', (err, row) => {
        const total = row?.count || 0;
        db.get("SELECT COUNT(*) as count FROM check_logs WHERE action != 'none'", (err2, row2) => {
          const trades = row2?.count || 0;
          db.get('SELECT timestamp, price, signal_buy, signal_sell FROM check_logs ORDER BY id DESC LIMIT 1', (err3, lastRow) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              totalChecks: total,
              totalTrades: trades,
              lastCheck: lastRow || null
            }));
          });
        });
      });
      return;
      
    } else {
      // 返回Dashboard HTML
      const htmlPath = path.join(__dirname, 'dashboard.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    }
  } catch(e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dashboard API 运行中: http://localhost:${PORT}`);
  console.log(`   - /api/status   (机器人状态)`);
  console.log(`   - /api/trades  (交易记录)`);
  console.log(`   - /api/positions (持仓信息)`);
  console.log(`   - /api/all     (汇总数据)`);
});
