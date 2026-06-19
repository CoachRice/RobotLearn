// client/src/hooks/usePybricks.js
// The PyBricks REPL uses the Nordic UART Service (NUS) for stdin/stdout,
// not the PyBricks WRITE_STDIN/WRITE_STDOUT characteristic events.
// Reference: https://pybricks.com/projects/tutorials/wireless/hub-to-device/pc-communication/
import { useState, useCallback, useRef } from 'react'

// ── PyBricks service ──────────────────────────────────────────
const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

// ── Nordic UART Service (NUS) — the REPL's actual stdio ───────
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const NUS_RX_UUID      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'  // browser → hub
const NUS_TX_UUID      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'  // hub → browser

// ── Commands (PyBricks characteristic) ───────────────────────
const CMD_STOP_USER_PROGRAM = 0x00
const CMD_START_REPL        = 0x02  // switch hub into interactive REPL mode

// ── MicroPython raw REPL control characters ───────────────────
// After START_REPL the hub enters normal REPL (">>> ").
// Ctrl+A switches to raw mode — no echo, batch execution.
const CTRL_C = 0x03  // interrupt any running code
const CTRL_A = 0x01  // enter raw mode
const CTRL_D = 0x04  // execute in raw mode / end paste

// ── Events (PyBricks characteristic notifications) ────────────
const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

const delay = ms => new Promise(r => setTimeout(r, ms))

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const pbCharRef  = useRef(null)   // PyBricks command/event char
  const nusRxRef   = useRef(null)   // NUS RX — we write here to send to hub
  const deviceRef  = useRef(null)
  const maxCharRef = useRef(512)

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  // ── PyBricks status/stdout events ─────────────────────────
  const handlePbNotification = useCallback((event) => {
    const d = new Uint8Array(event.target.value.buffer)
    if (d[0] === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(d.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (d[0] === EVT_STATUS_REPORT && d.length >= 5) {
      const flags   = new DataView(d.buffer).getUint32(1, true)
      const running = (flags & 0x0100) !== 0
      setStatus(running ? 'running' : 'connected')
    }
  }, [addOutput])

  // ── NUS TX notifications — REPL stdout comes here ─────────
  const handleNusTx = useCallback((event) => {
    const d    = new Uint8Array(event.target.value.buffer)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(d)
    // Strip MicroPython raw-mode control bytes and prompts
    const clean = text
      .replace(/\x04/g, '')               // Ctrl+D (end marker)
      .replace(/OK\r?\n?/g, '')           // raw mode OK response
      .replace(/raw REPL[^\r\n]*\r?\n/g, '')
      .replace(/\r/g, '')
    clean.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
  }, [addOutput])

  // ── connect ───────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg('Web Bluetooth requires Chrome or Edge on desktop.')
      return
    }
    setStatus('connecting'); setErrorMsg(null); setOutput([])
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters:          [{ services: [PYBRICKS_SERVICE_UUID] }],
        optionalServices: [
          PYBRICKS_SERVICE_UUID,
          PYBRICKS_CAPABILITIES_UUID,
          NUS_SERVICE_UUID,
        ],
      })
      deviceRef.current = device
      setHubName(device.name || 'Pybricks Hub')
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected')
        setHubName(null)
        pbCharRef.current = null
        nusRxRef.current  = null
        addOutput('⚠ Hub disconnected.')
      })

      const server = await device.gatt.connect()

      // ── PyBricks service ─────────────────────────────────
      const pbService = await server.getPrimaryService(PYBRICKS_SERVICE_UUID)

      try {
        const capChar = await pbService.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        const cv      = new DataView(capVal.buffer)
        maxCharRef.current = cv.getUint16(0, true)
        const flags   = capVal.byteLength >= 6  ? cv.getUint32(2, true) : 0
        const maxProg = capVal.byteLength >= 10 ? cv.getUint32(6, true) : 0
        addOutput(`✓ PyBricks: max_write=${maxCharRef.current}B caps=0x${flags.toString(16)}`)
      } catch (e) {
        addOutput(`⚠ Caps: ${e.message}`)
      }

      const pbChar = await pbService.getCharacteristic(PYBRICKS_CHAR_UUID)
      pbCharRef.current = pbChar
      await pbChar.startNotifications()
      pbChar.addEventListener('characteristicvaluechanged', handlePbNotification)

      // ── NUS service ──────────────────────────────────────
      try {
        const nusService = await server.getPrimaryService(NUS_SERVICE_UUID)
        const nusTxChar  = await nusService.getCharacteristic(NUS_TX_UUID)
        const nusRxChar  = await nusService.getCharacteristic(NUS_RX_UUID)

        await nusTxChar.startNotifications()
        nusTxChar.addEventListener('characteristicvaluechanged', handleNusTx)
        nusRxRef.current = nusRxChar
        addOutput('✓ NUS UART connected (REPL stdio)')
      } catch (e) {
        addOutput(`⚠ NUS not available: ${e.message}`)
        addOutput('  REPL output may not appear')
      }

      setStatus('connected')
      addOutput(`✓ Connected to ${device.name || 'Pybricks Hub'}`)
    } catch (err) {
      if (err.name !== 'NotFoundError') { setStatus('error'); setErrorMsg(err.message) }
      else setStatus('disconnected')
    }
  }, [handlePbNotification, handleNusTx])

  const disconnect = useCallback(async () => {
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect()
    setStatus('disconnected')
    setHubName(null)
    pbCharRef.current = null
    nusRxRef.current  = null
  }, [])

  const stop = useCallback(async () => {
    if (!pbCharRef.current) return
    try {
      // Interrupt via PyBricks command
      await pbCharRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_STOP_USER_PROGRAM])
      )
      // Also send Ctrl+C to interrupt any REPL operation
      if (nusRxRef.current) {
        await nusRxRef.current.writeValueWithoutResponse(new Uint8Array([CTRL_C]))
      }
      setStatus('connected'); addOutput('⏹ Stopped.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop: ' + e.message) }
  }, [addOutput])

  // ── run via NUS REPL ──────────────────────────────────────
  // 1. START_REPL via PyBricks char  → hub enters interactive mode
  // 2. Ctrl+A via NUS RX             → raw mode (batch execution, no echo)
  // 3. Python source via NUS RX      → hub buffers the code
  // 4. Ctrl+D via NUS RX             → hub compiles and runs
  // 5. Output via NUS TX notifications
  const run = useCallback(async (pythonCode) => {
    if (!pbCharRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)
    setStatus('running')

    // Chunk size for NUS writes (conservative — NUS may have smaller MTU)
    const nusChunk = Math.min(maxCharRef.current, 128)

    async function nusWrite(bytes) {
      if (!nusRxRef.current) return
      for (let off = 0; off < bytes.length; off += nusChunk) {
        const chunk = bytes.slice(off, off + nusChunk)
        await nusRxRef.current.writeValueWithoutResponse(chunk)
        await delay(30)
      }
    }

    try {
      // Stop anything running
      await pbCharRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_STOP_USER_PROGRAM])
      )
      await delay(400)

      // Ask hub to enter REPL mode
      addOutput('▶ Starting REPL...')
      await pbCharRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_START_REPL])
      )
      await delay(800)

      if (!nusRxRef.current) {
        addOutput('⚠ NUS RX not available — REPL input cannot be sent.')
        addOutput('  Check that NUS connected successfully above.')
        setStatus('connected')
        return
      }

      // Interrupt any current REPL activity
      await nusWrite(new Uint8Array([CTRL_C]))
      await delay(200)

      // Enter MicroPython raw mode
      addOutput('  Raw mode...')
      await nusWrite(new Uint8Array([CTRL_A]))
      await delay(400)

      // Send Python source code
      const codeBytes = new TextEncoder().encode(pythonCode)
      addOutput(`  Sending ${codeBytes.length}B source...`)
      await nusWrite(codeBytes)
      await delay(200)

      // Execute
      addOutput('─────────────────')
      await nusWrite(new Uint8Array([CTRL_D]))

    } catch (e) {
      setStatus('error')
      setErrorMsg('Run error: ' + e.message)
      addOutput('✗ ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
