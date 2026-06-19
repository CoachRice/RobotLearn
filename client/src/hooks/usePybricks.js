// client/src/hooks/usePybricks.js
//
// Connects to a Spike Prime hub running PyBricks firmware over Web Bluetooth,
// and runs Python code by feeding it line-by-line to the hub's interactive
// REPL — waiting for the ">>> " prompt to reappear after each line before
// sending the next one. This mirrors typing into the REPL by hand.
//
// NOTE: this hub's firmware has raw-mode REPL paste (Ctrl+A) disabled, so
// the usual "send the whole program in one block" approach doesn't work.
// Line-by-line feeding via WRITE_STDIN is the confirmed working method.
//
// LIMITATION: indented blocks (for/while/if/def) are not yet supported —
// the REPL switches to a "... " continuation prompt for those, which this
// version doesn't handle. Flat, top-level-statement programs work correctly.
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

const CMD_STOP_USER_PROGRAM = 0x00
const CMD_START_REPL        = 0x02
const CMD_WRITE_STDIN       = 0x06

const CTRL_C = 0x03  // interrupt currently-executing line
const CTRL_B = 0x02  // exit raw mode (safety reset, in case hub is stuck)
const CTRL_D = 0x04  // soft-reboot — exits REPL, returns hub to idle state

const EVT_WRITE_STDOUT = 0x01

const delay = ms => new Promise(r => setTimeout(r, ms))

async function pbWrite(char, data) {
  await char.writeValue(data instanceof Uint8Array ? data : new Uint8Array(data))
}

async function writeStdinChunked(pbChar, bytes, maxCharSize) {
  const maxPayload = maxCharSize - 1
  for (let off = 0; off < bytes.length; off += maxPayload) {
    const chunk  = bytes.slice(off, off + maxPayload)
    const packet = new Uint8Array(1 + chunk.length)
    packet[0] = CMD_WRITE_STDIN
    packet.set(chunk, 1)
    await pbWrite(pbChar, packet)
  }
}

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const pbCharRef   = useRef(null)
  const deviceRef   = useRef(null)
  const maxCharRef  = useRef(512)
  const replBufRef  = useRef('')   // accumulates raw REPL text for prompt detection
  const stopFlagRef = useRef(false)

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handlePbNotification = useCallback((event) => {
    const d = new Uint8Array(event.target.value.buffer)
    if (d[0] === EVT_WRITE_STDOUT) {
      replBufRef.current += new TextDecoder('utf-8', { fatal: false }).decode(d.slice(1))
    }
  }, [])

  // ── connect ───────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg('Web Bluetooth requires Chrome or Edge on a desktop computer.')
      return
    }
    setStatus('connecting'); setErrorMsg(null); setOutput([])
    replBufRef.current = ''

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters:          [{ services: [PYBRICKS_SERVICE_UUID] }],
        optionalServices: [PYBRICKS_SERVICE_UUID, PYBRICKS_CAPABILITIES_UUID],
      })
      deviceRef.current = device
      setHubName(device.name || 'Hub')
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected'); setHubName(null); pbCharRef.current = null
        addOutput('⚠ Hub disconnected.')
      })

      const server = await device.gatt.connect()
      const pbSvc  = await server.getPrimaryService(PYBRICKS_SERVICE_UUID)

      try {
        const capChar = await pbSvc.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        maxCharRef.current = new DataView(capVal.buffer).getUint16(0, true)
      } catch { /* fall back to default chunk size */ }

      const pbChar = await pbSvc.getCharacteristic(PYBRICKS_CHAR_UUID)
      pbCharRef.current = pbChar
      await pbChar.startNotifications()
      pbChar.addEventListener('characteristicvaluechanged', handlePbNotification)

      setStatus('connected')
      addOutput(`✓ Connected to ${device.name || 'Hub'}`)
    } catch (err) {
      if (err.name !== 'NotFoundError') { setStatus('error'); setErrorMsg(err.message) }
      else setStatus('disconnected')
    }
  }, [handlePbNotification, addOutput])

  const disconnect = useCallback(async () => {
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect()
    setStatus('disconnected'); setHubName(null); pbCharRef.current = null
  }, [])

  // ── stop ──────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!pbCharRef.current) return
    stopFlagRef.current = true
    try {
      // Interrupt whatever line is currently executing
      await writeStdinChunked(pbCharRef.current, new Uint8Array([CTRL_C]), maxCharRef.current)
      await delay(300)
      // Exit REPL cleanly so the hub light returns to its idle state
      await writeStdinChunked(pbCharRef.current, new Uint8Array([CTRL_D]), maxCharRef.current)
      addOutput('⏹ Stopped.')
    } catch (e) { setErrorMsg('Stop: ' + e.message) }
    setStatus('connected')
  }, [addOutput])

  // ── send one line, wait for the REPL prompt, return its output ─
  async function sendLineAndWait(pb, line, timeoutMs) {
    const startLen = replBufRef.current.length
    const bytes    = new TextEncoder().encode(line + '\r\n')
    await writeStdinChunked(pb, bytes, maxCharRef.current)

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (stopFlagRef.current) return { text: '', stopped: true }
      const newText = replBufRef.current.slice(startLen)
      if (newText.includes('>>> ')) {
        let result = newText
        const echoPrefix = line + '\r\n'
        if (result.startsWith(echoPrefix)) result = result.slice(echoPrefix.length)
        result = result.replace(/>>> $/, '').replace(/\r\n$/, '')
        return { text: result, stopped: false }
      }
      await delay(40)
    }
    return { text: null, stopped: false }  // timed out
  }

  // ── run: feed the program to the REPL line by line ────────
  const run = useCallback(async (pythonCode) => {
    if (!pbCharRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)
    setStatus('running')
    stopFlagRef.current = false
    replBufRef.current  = ''
    const pb = pbCharRef.current

    try {
      // Reset to a clean REPL state before each run
      await pbWrite(pb, [CMD_STOP_USER_PROGRAM])
      await delay(300)
      await writeStdinChunked(pb, new Uint8Array([CTRL_B]), maxCharRef.current)
      await delay(200)
      await writeStdinChunked(pb, new Uint8Array([CTRL_C]), maxCharRef.current)
      await delay(200)
      await pbWrite(pb, [CMD_START_REPL])
      await delay(1500)  // let the boot banner finish streaming
      replBufRef.current = ''  // discard banner text

      addOutput('▶ Running...')
      addOutput('─────────────────')

      const lines = pythonCode.split('\n')
      for (const rawLine of lines) {
        if (stopFlagRef.current) { addOutput('⏹ Stopped by user.'); break }

        const line    = rawLine.replace(/\r$/, '')
        const trimmed = line.trim()

        const { text, stopped } = await sendLineAndWait(pb, line, 6000)
        if (stopped) { addOutput('⏹ Stopped by user.'); break }
        if (text === null) {
          addOutput(`⚠ No response from hub for: ${line || '(blank line)'}`)
          continue
        }

        // Comments and blank lines never produce real output — skip display
        if (trimmed === '' || trimmed.startsWith('#')) continue

        if (text.trim().length > 0) {
          text.split('\n').filter(l => l.trim()).forEach(l => addOutput(l))
        }
      }

      if (!stopFlagRef.current) {
        addOutput('─────────────────')
        addOutput('✓ Program finished')
      }

      // Exit REPL and return hub to its normal idle state.
      // Ctrl+D at the friendly >>> prompt triggers a soft-reboot,
      // which cleanly exits REPL mode (otherwise the hub's light
      // stays in its "REPL active" indicator pattern forever).
      await writeStdinChunked(pb, new Uint8Array([CTRL_D]), maxCharRef.current)
      await delay(300)

      setStatus('connected')
    } catch (e) {
      setStatus('error'); setErrorMsg('Run error: ' + e.message)
      addOutput('✗ ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
