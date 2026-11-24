// 带上限的请求体读取。
//
// 为什么单独一个模块：本地 Responses 代理（src/proxy.js）与设置页路由（src/host.js）
// 都要读请求体，两处都必须在超限时把 413 正常送出去。以前两处都是「先 reject 再
// req.destroy()」，socket 一断响应就写不回去，调用方只看到 ECONNRESET —— DSH 会
// 把它当成一次网络故障，用户拿到的提示完全指错方向。
//
// 正确做法：停止缓存、把剩余字节丢掉（resume），让调用方正常写 413；
// 响应里声明 connection: close，连接在响应刷出后由 Node 关闭。

export function readRequestBody(req, maxBytes) {
  const limit = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : 0
  return new Promise(function (resolve, reject) {
    let size = 0
    let settled = false
    const chunks = []
    req.on('data', function (chunk) {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        settled = true
        chunks.length = 0
        req.removeAllListeners('data')
        req.resume()
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
