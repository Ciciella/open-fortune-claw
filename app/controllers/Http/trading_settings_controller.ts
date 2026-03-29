import type { HttpContext } from '@adonisjs/core/http'
import { getDb } from '../../services/database.js'

const MAX_LEVERAGE = 100

export default class TradingSettingsController {
  async index({ response }: HttpContext) {
    try {
      const db = getDb()
      const row = db.prepare('SELECT leverage, updated_at FROM settings WHERE id = 1').get() as any
      return response.json({
        success: true,
        settings: {
          leverage: row?.leverage || 10,
          updatedAt: row?.updated_at || null
        }
      })
    } catch (e: any) {
      return response.json({ success: false, error: e.message })
    }
  }

  async update({ request, response }: HttpContext) {
    try {
      const body = await request.body()
      let leverage = parseInt(body.leverage)
      let warning = null

      if (isNaN(leverage) || leverage < 1) {
        return response.status(400).json({
          success: false,
          error: '杠杆倍数必须大于等于1'
        })
      }

      if (leverage > MAX_LEVERAGE) {
        warning = `杠杆已限制在安全值 ${MAX_LEVERAGE}x（原始请求: ${leverage}x）`
        leverage = MAX_LEVERAGE
      }

      const db = getDb()
      db.prepare('UPDATE settings SET leverage = ?, updated_at = ? WHERE id = 1').run(leverage, new Date().toISOString())

      const result: any = {
        success: true,
        settings: { leverage, updatedAt: new Date().toISOString() }
      }
      if (warning) result.warning = warning
      return response.json(result)
    } catch (e: any) {
      return response.status(500).json({ success: false, error: e.message })
    }
  }
}
