// dsh-chatgpt-sub — HTTP 请求体读取（host 的 RPC 路由与本地代理共用）
//
// 为什么单独一份：两处以前各抄一份 readBody，超限时都在 reject 的同一 tick 里
// req.destroy()。IncomingMessage.destroy() 会把底层 socket 一并毁掉，于是调用方
// 随后想发的 413 响应根本写不出去——客户端只看到连接被重置，只能按网络故障
// 去猜。413 发不出去，限额本身形同虚设。
//
// 这里的契约：
//   - 超限 → 立刻以带 status 413 的错误 reject，但不毁连接；后续数据只排空、
//     不再缓存（data 监听保持挂载，流自然保持 flowing，读完即弃）。
//   - 调用方据此把 413 响应真正写回客户端，并带上 connection: close，
//     响应送达后由服务端关连接，不给未读完的请求体留半开状态。
//   - 未超限 → 'end' 时以 utf8 字符串 resolve；流本身报错则原样 reject。

export function readRequestBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    let size = 0
    let settled = false
    const chunks = []
    req.on('data', function (chunk) {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        reject(Object.assign(new Error('payload too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', function () {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', function (err) {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}
