// client/src/hooks/usePybricks.js
//
// CONFIRMED WORKING APPROACH:
//   This hub's firmware has raw-mode REPL paste (Ctrl+A) disabled.
//   The friendly REPL (>>> prompt) executes single lines perfectly.
//   So we feed the program one line at a time via WRITE_STDIN,
//   waiting for the ">>> " prompt to reappear before sending the next line.
//   This mirrors exactly what a human typing into the REPL would do.
//
// Limitation: indented blocks (for/while/if/def) need the REPL's "..."
// continuation prompt handled differently — not yet implemented.
// Flat, top-level statement programs (like our Level 1 Topic 2-4 tasks)
// work correctly with this approach.
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

const CMD_STOP_USER_PROGRAM = 0x00
const CMD_START_REPL        = 0x02
const CMD_WRITE_STDIN       = 0x06

const CTRL_C = 0x03
const CTRL_B = 0x02

const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

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

  const pbCharRef  = useRef(null)
  const deviceRef  = useRef(null)
  const maxCharRef = useRef(512)
  const replBufRef = useRef('')  // accumulates raw REPL text for prompt detection

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handlePbNotification = useCallback((event) => {
    const d = new Uint8Array(event.target.value.buffer)
    if (d[0] === EVT_WRITE_STDOUT) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(d.slice(1))
      replBufRef.current += text
    }
    if (d[0] === EVT_STATUS_REPORT && d.length >= 5) {
      const flags = new DataView(d.buffer).getUint32(1, true)
      // Don't override our own 'running' state from the status flag —
      // REPL-driven execution doesn't set USER_PROGRAM_RUNNING.
    }
  }, [])

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg('Web Bluetooth requires Chrome or Edge on desktop.')
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
      } catch { /* use default */ }

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

  const stop = useCallback(async () => {
    if (!pbCharRef.current) return
    try {
      // Ctrl+C interrupts whatever line is currently executing (e.g. a long wait())
      await writeStdinChunked(pbCharRef.current, new Uint8Array([CTRL_C]), maxCharRef.current)
      setStatus('connected'); addOutput('⏹ Stopped.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop: ' + e.message) }
  }, [addOutput])

  // ── Send one line, wait for the >>> prompt, return real output ─
  async function sendLineAndWait(pb, line, timeoutMs) {
    const startLen = replBufRef.current.length
    const bytes    = new TextEncoder().encode(line + '\r\n')
    await writeStdinChunked(pb, bytes, maxCharRef.current)

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const newText = replBufRef.current.slice(startLen)
      if (newText.includes('>>> ')) {
        // Strip the echoed input line and the trailing prompt,
        // leaving only the line's actual print() output (if any).
        let result = newText
        const echoPrefix = line + '\r\n'
        if (result.startsWith(echoPrefix)) result = result.slice(echoPrefix.length)
        result = result.replace(/>>> $/, '').replace(/\r\n$/, '')
        return result
      }
      await delay(40)
    }
    return null  // timed out — no prompt seen
  }

  // ── run: feed the program to the friendly REPL, line by line ──
  const run = useCallback(async (pythonCode) => {
    if (!pbCharRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)
    setStatus('running')
    replBufRef.current = ''
    const pb = pbCharRef.current

    try {
      // Reset to a clean REPL state
      await pbWrite(pb, [CMD_STOP_USER_PROGRAM])
      await delay(300)
      await writeStdinChunked(pb, new Uint8Array([CTRL_B]), maxCharRef.current)
      await delay(200)
      await writeStdinChunked(pb, new Uint8Array([CTRL_C]), maxCharRef.current)
      await delay(200)
      await pbWrite(pb, [CMD_START_REPL])
      await delay(1500)  // let boot banner finish
      replBufRef.current = ''  // clear banner text from buffer

      addOutput('▶ Running...')
      addOutput('─────────────────')

      // Feed line-by-line, waiting for prompt between each
      const lines = pythonCode.split('\n')
      for (const rawLine of lines) {
        const line    = rawLine.replace(/\r$/, '')
        const trimmed = line.trim()
        // Generous timeout per line (covers wait() calls up to several seconds)
        const result = await sendLineAndWait(pb, line, 6000)
        if (result === null) {
          addOutput(`⚠ No response for line: ${line || '(blank)'}`)
          continue
        }
        // Comments and blank lines never produce real output — skip them
        // entirely rather than risk showing a mis-stripped echo.
        if (trimmed === '' || trimmed.startsWith('#')) continue

        // Show any real print() output from this line
        if (result.trim().length > 0) {
          result.split('\n').filter(l => l.trim()).forEach(l => addOutput(l))
        }
      }

      addOutput('─────────────────')
      addOutput('✓ Program finished')
      setStatus('connected')
    } catch (e) {
      setStatus('error'); setErrorMsg('Run error: ' + e.message)
      addOutput('✗ ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
