import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const pageUrl = process.env.PATTS_MEDIA_URL || 'http://localhost:4173/'
const profile = mkdtempSync(join(tmpdir(), 'patts-media-'))
const port = 9700 + Math.floor(Math.random() * 400)
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true })
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

async function connect() {
  let target
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((page) => page.type === 'page')
      if (target) break
    } catch { /* Chrome is starting. */ }
    await wait(100)
  }
  if (!target) throw new Error('Chrome DevTools did not start')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', fail, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { done, fail } = pending.get(message.id)
    pending.delete(message.id)
    message.error ? fail(new Error(message.error.message)) : done(message.result)
  })
  return {
    send: (method, params = {}) => new Promise((done, fail) => {
      const requestId = ++id
      pending.set(requestId, { done, fail })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    }),
    close: () => socket.close(),
  }
}

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}

async function viewport(send, width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 500,
    screenWidth: width, screenHeight: height,
  })
  await wait(250)
}

async function route(send, name) {
  await evaluate(send, `location.hash = ${JSON.stringify(name)}; true`)
  await wait(350)
}

async function screenshot(send, path) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
  writeFileSync(resolve(path), Buffer.from(data, 'base64'))
}

async function video(send, name, width, height, scenes) {
  await viewport(send, width, height)
  const frames = join(profile, name)
  mkdirSync(frames)
  let frame = 0
  for (const scene of scenes) {
    await route(send, scene)
    for (let step = 0; step < 16; step += 1) {
      await screenshot(send, join(frames, `${String(frame++).padStart(4, '0')}.png`))
      await wait(200)
    }
  }
  const encoded = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', '5', '-i', join(frames, '%04d.png'),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', resolve(`docs/videos/${name}.mp4`),
  ], { encoding: 'utf8', windowsHide: true })
  if (encoded.status !== 0) throw new Error(encoded.stderr || 'ffmpeg failed')
}

try {
  mkdirSync(resolve('docs/screenshots'), { recursive: true })
  mkdirSync(resolve('docs/videos'), { recursive: true })
  const browser = await connect()
  try {
    await browser.send('Page.enable')
    await viewport(browser.send, 1440, 900)
    await browser.send('Page.navigate', { url: pageUrl })
    await wait(750)
    await screenshot(browser.send, 'docs/screenshots/teller-setup.png')
    const unlocked = await evaluate(browser.send, `(async () => {
      const form = document.querySelector('#access-form');
      if (!form) return false;
      form.elements.tellerName.value = 'Demo Teller';
      form.elements.pin.value = '2468';
      form.elements.confirmPin.value = '2468';
      form.requestSubmit();
      for (let i = 0; i < 40; i++) {
        if (!document.querySelector('.access-page')) return true;
        await new Promise((done) => setTimeout(done, 100));
      }
      return false;
    })()`)
    if (!unlocked) throw new Error('Demo teller setup did not complete')
    await wait(4500)
    await route(browser.send, 'wallet')
    await screenshot(browser.send, 'docs/screenshots/wallet-desktop.png')
    await evaluate(browser.send, `document.querySelector('[data-quick-amount="5000"]').click(); true`)
    await evaluate(browser.send, `document.querySelector('[data-action="topup"]').click(); true`)
    await wait(350)
    await screenshot(browser.send, 'docs/screenshots/transaction-confirmation.png')
    await evaluate(browser.send, `document.querySelector('#confirm-transaction-button').click(); true`)
    await wait(4500)
    for (const name of ['students', 'activity', 'settings']) {
      await route(browser.send, name)
      await screenshot(browser.send, `docs/screenshots/${name}-desktop.png`)
    }
    await viewport(browser.send, 390, 844)
    for (const name of ['wallet', 'students']) {
      await route(browser.send, name)
      await screenshot(browser.send, `docs/screenshots/${name}-mobile.png`)
    }
    await video(browser.send, 'desktop-tour', 1280, 720, ['wallet', 'students', 'activity', 'settings'])
    await video(browser.send, 'mobile-tour', 390, 844, ['wallet', 'students', 'activity'])
    process.stdout.write('Captured PATTS POS screenshots and videos.\n')
  } finally {
    browser.close()
  }
} finally {
  if (chrome.exitCode === null) {
    const exited = new Promise((done) => chrome.once('exit', done))
    chrome.kill()
    await Promise.race([exited, wait(2000)])
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (error) {
    if (error?.code !== 'EPERM') throw error
  }
}
