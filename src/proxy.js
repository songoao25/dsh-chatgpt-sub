// 本地 Responses 规范化代理。
//
// 为什么需要它：DSH 的 pi-ai 适配器已经把流式解析、工具调用、图片、压缩都做好了，
// 但它发出的 Responses 请求是「普通 OpenAI 平台」的形状 —— 工具平铺在 tools 数组里，
// system 消息也照原样发送。SIWC 要求工具放进 namespace、system 改成 developer，
// 并且拒绝 max_output_tokens / temperature 等字段。与其 fork pi-ai，不如在
// 127.0.0.1 上放一个只做请求规范化的小代理：DSH 仍然用自己最熟悉的适配器，
// 协议差异集中在这一个文件里。
//
// 约束：
//   - 只监听 127.0.0.1；
//   - 只接受 /v1/responses 与 /v1/models；
//   - Authorization 必须等于插件当前的 access token，避免变成任意本地转发器；
//   - 上游固定 https://api.openai.com，不接受请求方指定。

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { normalizeResponsesBody } from './siwc.js'
import { classifyNetworkError } from './network.js'

const MAX_BODY_BYTES = 48 * 1024 * 1024

// 上游连不上时，代理把失败原因一并带给调用方。
// 以前这里只回一句「Could not reach ChatGPT」，调用方（DSH 的模型适配器）无从
// 区分是 DNS 不通、代理端口没起还是握手被掐断，用户只能自己猜。
// reason 取值与 src/network.js 一致（timeout / dns / refused / unreachable / proxy-reset / unknown）。
const UPSTREAM_MESSAGES = {
  timeout: 'Timed out reaching ChatGPT',
  dns: 'The ChatGPT domain name did not resolve',
  refused: 'The connection to ChatGPT was refused',
  unreachable: 'The network to ChatGPT is unreachable',
  'proxy-reset': 'The connection to ChatGPT was closed before the encrypted handshake finished',
}

function sendJson(res, status, payload) {
  if (res.headersSent) { try { res.destroy() } catch (err) {} return }
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0
    const chunks = []
    req.on('data', function (chunk) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

function bearerToken(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

function pickResponseHeaders(headers) {
  const out = {}
  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase()
    if (lower === 'content-encoding' || lower === 'content-length' || lower === 'transfer-encoding' ||
        lower === 'connection' || lower === 'keep-alive') continue
    out[name] = value
  }
  return out
}

/**
 * @param {{ getAccessToken: () => string | null, upstreamOrigin?: string, log?: (msg: string) => void }} options
 * @returns {Promise<{ port: number, baseUrl: string, close: () => void }>}
 */
export function startResponsesProxy(options) {
  const getAccessToken = options.getAccessToken
  const upstreamOrigin = options.upstreamOrigin || 'https://api.openai.com'
  const log = typeof options.log === 'function' ? options.log : function () {}

  return new Promise(function (resolve, reject) {
    const server = createServer(async function (req, res) {
      const started = Date.now()
      let pathname = '/'
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        pathname = url.pathname
      } catch (err) {
        sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'Invalid request URL' } })
        return
      }

      if (pathname !== '/v1/responses' && pathname !== '/v1/models') {
        sendJson(res, 404, { error: { type: 'invalid_request_error', message: 'Not found' } })
        return
      }
      if (pathname === '/v1/responses' && req.method !== 'POST') {
        sendJson(res, 405, { error: { type: 'invalid_request_error', message: 'Method not allowed' } })
        return
      }
      if (pathname === '/v1/models' && req.method !== 'GET') {
        sendJson(res, 405, { error: { type: 'invalid_request_error', message: 'Method not allowed' } })
        return
      }

      // 只认当前令牌：代理不能被本机其他进程当成免费转发器。
      const expectedRaw = typeof getAccessToken === 'function' ? getAccessToken() : null
      const accepted = Array.isArray(expectedRaw) ? expectedRaw.filter(Boolean) : (expectedRaw ? [expectedRaw] : [])
      const presented = bearerToken(req)
      if (accepted.length === 0 || !presented || !accepted.includes(presented)) {
        sendJson(res, 401, { error: { type: 'authentication_error', message: 'ChatGPT credential is missing or stale' } })
        return
      }

      let body = null
      if (pathname === '/v1/responses') {
        try {
          const raw = await readBody(req)
          const parsed = JSON.parse(raw)
          body = JSON.stringify(normalizeResponsesBody(parsed))
        } catch (err) {
          const status = err && err.status === 413 ? 413 : 400
          sendJson(res, status, { error: { type: 'invalid_request_error', message: status === 413 ? 'Request body is too large' : 'Request body is not valid JSON' } })
          return
        }
      }

      const controller = new AbortController()
      req.on('aborted', function () { controller.abort() })
      res.on('close', function () { if (!res.writableFinished) controller.abort() })

      const headers = {
        authorization: 'Bearer ' + presented,
        accept: pathname === '/v1/responses' ? 'text/event-stream' : 'application/json',
      }
      if (pathname === '/v1/responses') headers['content-type'] = 'application/json'

      try {
        const upstream = await fetch(upstreamOrigin + pathname, {
          method: pathname === '/v1/responses' ? 'POST' : 'GET',
          headers: headers,
          body: body === null ? undefined : body,
          signal: controller.signal,
        })
        res.writeHead(upstream.status, pickResponseHeaders(upstream.headers))
        if (!upstream.body) { res.end(); return }
        const stream = Readable.fromWeb(upstream.body)
        stream.on('error', function (err) {
          try { res.destroy(err) } catch (destroyErr) {}
        })
        stream.pipe(res)
        stream.on('end', function () {
          log('proxy ' + pathname + ' ' + upstream.status + ' ' + (Date.now() - started) + 'ms')
        })
      } catch (err) {
        if (controller.signal.aborted) { try { res.destroy() } catch (destroyErr) {} ; return }
        // 上游失败也分原因：调用方拿得到 reason 才知道是代理没起还是 DNS 不通。
        const failure = classifyNetworkError(err)
        const reason = failure && typeof failure.reason === 'string' ? failure.reason : 'unknown'
        log('proxy ' + pathname + ' upstream failed (' + reason + '): ' + (err && err.message ? err.message : 'unknown error'))
        sendJson(res, 502, {
          error: {
            type: 'upstream_error',
            message: UPSTREAM_MESSAGES[reason] || 'Could not reach ChatGPT',
            reason: reason,
          },
        })
      }
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', function () {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      resolve({
        port: port,
        baseUrl: 'http://127.0.0.1:' + port + '/v1',
        close: function () {
          try { server.close() } catch (err) {}
          try { server.closeAllConnections && server.closeAllConnections() } catch (err) {}
        },
      })
    })
  })
}
