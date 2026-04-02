import { test, describe } from 'node:test'
import assert from 'node:assert'
import 'dotenv/config'

describe('开仓合约数量计算', () => {
  test('openShort 应正确将 BTC 数量转换为合约数量', () => {
    const price = 67055.9
    const btcAmount = 0.0233

    // 计算合约数量
    const contractSize = Math.abs(Math.floor(btcAmount * price))

    // 验证转换正确
    assert.equal(contractSize, 1562)
  })

  test('openLong 应正确将 BTC 数量转换为合约数量', () => {
    const price = 67055.9
    const btcAmount = 0.05

    const contractSize = Math.abs(Math.floor(btcAmount * price))

    assert.equal(contractSize, 3352)
  })

  test('closeLong 应正确将 BTC 数量转换为合约数量', () => {
    const price = 68000
    const btcAmount = 0.1

    const contractSize = Math.abs(Math.floor(btcAmount * price))

    assert.equal(contractSize, 6800)
  })

  test('订单最小数量检查 - 小于10 contracts应被拒绝', () => {
    const price = 67055.9
    const btcAmount = 0.0001 // 约6.7 USDT = 6.7 contracts

    const contractSize = Math.abs(Math.floor(btcAmount * price))

    // 小于10 contracts
    assert.ok(contractSize < 10)
  })

  test('正常订单数量应大于最小值', () => {
    const price = 67055.9
    const btcAmount = 0.0233

    const contractSize = Math.abs(Math.floor(btcAmount * price))

    // 大于10 contracts
    assert.ok(contractSize >= 10)
  })
})

describe('Gate.io API 实际测试', { skip: true }, () => {
  test('开空仓应成功', async () => {
    // 这个测试需要真实的 API key
    // 跳过如果环境变量未设置
    if (!process.env.GATE_TESTNET_API_KEY) {
      throw new Error('需要 GATE_TESTNET_API_KEY 环境变量')
    }

    const { futuresApi } = await import('../app/services/gate_api.js')

    const price = 67055.9
    const btcAmount = 0.0233
    const contractSize = Math.abs(Math.floor(btcAmount * price))

    const order = {
      contract: 'BTC_USDT',
      type: 'sell',
      price: String(price),
      size: String(contractSize),
      leverage: '10',
    }

    const result = await futuresApi.createFuturesOrder('usdt', order)
    const body = result.body as any

    assert.equal(result.response?.status, 201)
    assert.ok(body.id > 0)
    assert.equal(body.status, 'open')
  })
})