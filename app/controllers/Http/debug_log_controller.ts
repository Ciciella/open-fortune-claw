import type { HttpContext } from '@adonisjs/core/http'
import { all } from '#services/database'

export default class DebugLogController {
  async index({ request, response }: HttpContext) {
    const limit = request.qs().limit ? parseInt(request.qs().limit) : 50
    const level = request.qs().level
    const category = request.qs().category

    // Build params in correct order (WHERE conditions first, LIMIT last)
    const params: any[] = []
    const conditions: string[] = []

    if (level) {
      conditions.push('level = ?')
      params.push(level)
    }
    if (category) {
      conditions.push('category = ?')
      params.push(category)
    }

    let sql = conditions.length > 0
      ? 'SELECT * FROM debug_logs WHERE ' + conditions.join(' AND ') + ' ORDER BY id DESC LIMIT ?'
      : 'SELECT * FROM debug_logs ORDER BY id DESC LIMIT ?'

    params.push(limit) // LIMIT always at end

    const logs = all(sql, params)

    return response.json({
      success: true,
      logs: logs.map((log: any) => ({
        id: log.id,
        timestamp: log.timestamp,
        level: log.level,
        category: log.category,
        message: log.message,
        details: log.details
      }))
    })
  }
}
