/**
 * 日志功能测试脚本
 * 测试 check_logs 表的读写功能
 * 
 * 运行: node experiments/test-logs.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'trading.db');
const db = new Database(DB_PATH);

console.log('🧪 开始测试日志功能...\n');

// 测试1: 检查表是否存在
console.log('📋 测试1: 检查 check_logs 表是否存在');
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='check_logs'").get();
  if (tables) {
    console.log('  ✅ check_logs 表存在\n');
  } else {
    console.log('  ❌ check_logs 表不存在\n');
    process.exit(1);
  }
} catch (e) {
  console.log('  ❌ 测试失败:', e.message, '\n');
  process.exit(1);
}

// 测试2: 检查表结构
console.log('📋 测试2: 检查表结构');
const columns = db.prepare('PRAGMA table_info(check_logs)').all();
const requiredColumns = [
  'timestamp', 'price', 'position_size', 'position_entry_price',
  'balance_total', 'balance_available', 'rsi', 'ma10', 'ma20', 'ma50',
  'macd_hist', 'trend', 'volume_ok', 'signal_buy', 'signal_sell',
  'signal_strength', 'signal_reason', 'action', 'action_amount', 'action_price', 'pnl_percent'
];

let missingColumns = [];
for (const col of requiredColumns) {
  if (!columns.find(c => c.name === col)) {
    missingColumns.push(col);
  }
}

if (missingColumns.length === 0) {
  console.log('  ✅ 所有必需字段都存在\n');
} else {
  console.log('  ❌ 缺少字段:', missingColumns.join(', '), '\n');
  process.exit(1);
}

// 测试3: 插入测试数据
console.log('📋 测试3: 插入测试数据');
const testData = {
  timestamp: new Date().toISOString(),
  price: 50000,
  position_size: 10,
  position_entry_price: 49000,
  balance_total: 1000,
  balance_available: 800,
  rsi: 35.5,
  ma10: 50000,
  ma20: 49500,
  ma50: 49000,
  macd_hist: 100,
  trend: 'up',
  volume_ok: 1,
  signal_buy: 1,
  signal_sell: 0,
  signal_strength: 3,
  signal_reason: '测试信号',
  action: 'test_action',
  action_amount: 1,
  action_price: 50000,
  pnl_percent: 2.5
};

try {
  const stmt = db.prepare(`
    INSERT INTO check_logs (
      timestamp, price, position_size, position_entry_price,
      balance_total, balance_available, rsi, ma10, ma20, ma50,
      macd_hist, trend, volume_ok, signal_buy, signal_sell,
      signal_strength, signal_reason, action, action_amount, action_price, pnl_percent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    testData.timestamp, testData.price, testData.position_size, testData.position_entry_price,
    testData.balance_total, testData.balance_available, testData.rsi, testData.ma10, testData.ma20, testData.ma50,
    testData.macd_hist, testData.trend, testData.volume_ok, testData.signal_buy, testData.signal_sell,
    testData.signal_strength, testData.signal_reason, testData.action, testData.action_amount, testData.action_price, testData.pnl_percent
  );
  
  const insertedId = result.lastInsertRowid;
  console.log(`  ✅ 插入成功, ID: ${insertedId}\n`);
  
  // 测试4: 查询测试数据
  console.log('📋 测试4: 查询测试数据');
  const inserted = db.prepare('SELECT * FROM check_logs WHERE id = ?').get(insertedId);
  
  if (inserted && inserted.price === testData.price && inserted.signal_strength === testData.signal_strength) {
    console.log('  ✅ 查询成功，数据一致\n');
  } else {
    console.log('  ❌ 查询失败或数据不一致\n');
    process.exit(1);
  }
  
  // 测试5: 删除测试数据
  console.log('📋 测试5: 删除测试数据');
  db.prepare('DELETE FROM check_logs WHERE id = ?').run(insertedId);
  const deleted = db.prepare('SELECT * FROM check_logs WHERE id = ?').get(insertedId);
  
  if (!deleted) {
    console.log('  ✅ 删除成功\n');
  } else {
    console.log('  ❌ 删除失败\n');
    process.exit(1);
  }
  
} catch (e) {
  console.log('  ❌ 测试失败:', e.message, '\n');
  process.exit(1);
}

// 测试6: 统计功能
console.log('📋 测试6: 测试统计查询');
try {
  const total = db.prepare('SELECT COUNT(*) as count FROM check_logs').get().count;
  const trades = db.prepare("SELECT COUNT(*) as count FROM check_logs WHERE action != 'none'").get().count;
  const lastCheck = db.prepare('SELECT * FROM check_logs ORDER BY id DESC LIMIT 1').get();
  
  console.log(`  ✅ 总检查次数: ${total}`);
  console.log(`  ✅ 实际交易次数: ${trades}`);
  console.log(`  ✅ 最新检查时间: ${lastCheck?.timestamp || '无'}\n`);
} catch (e) {
  console.log('  ❌ 统计查询失败:', e.message, '\n');
}

// 测试7: API 端点测试
console.log('\n📋 测试7: 测试 API 端点');
const http = require('http');

function testApi(url, name) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success) {
            console.log(`  ✅ ${name}: OK (${json.logs?.length || 0} 条日志)`);
            resolve(true);
          } else {
            console.log(`  ⚠️ ${name}: ${json.error || '返回格式异常'}`);
            resolve(false);
          }
        } catch (e) {
          console.log(`  ❌ ${name}: 解析失败`);
          resolve(false);
        }
      });
    }).on('error', () => {
      console.log(`  ❌ ${name}: 连接失败 (服务未运行?)`);
      resolve(false);
    });
  });
}

(async () => {
  await testApi('http://127.0.0.1:3000/logs?limit=5', '/logs');
  await testApi('http://127.0.0.1:3000/stats', '/stats');
  await testApi('http://127.0.0.1:3000/api/logs?limit=5', '/api/logs');
  await testApi('http://127.0.0.1:3000/api/stats', '/api/stats');
  
  console.log('\n🎉 所有测试通过!');
  db.close();
})();
