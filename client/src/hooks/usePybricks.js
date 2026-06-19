// client/src/hooks/usePybricks.js
//
// KEY DISCOVERIES from diagnostic run:
//   1. PyBricks char props = write|notify (NOT writeWithoutResponse)
//      → All previous writeValueWithoutResponse calls were silently dropped!
//      → Must use writeValue (with response) for PyBricks characteristic.
//   2. REPL output comes via NUS TX ✓
//   3. REPL INPUT must go via WRITE_STDIN (0x06) on PyBricks char, NOT via NUS RX.
//
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'
const NUS_SERVICE_UUID           = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const NUS_TX_UUID                = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'  // hub→browser

const CMD_STOP_USER_PROGRAM = 0x00
const CMD_START_REPL        = 0x02
const CMD_WRITE_STDIN       = 0x06  // REPL input goes here, not NUS RX

const CTRL_C = 0x03  // interrupt
const CTRL_A = 0x01  // enter MicroPython raw mode
const CTRL_D = 0x04  // execute in raw mode

const EVT_STATUS_REPORT = 0x00

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Write to PyBricks char with response; tolerate Chrome timeouts ─
// PyBricks char requires writeValue (no writeWithoutResponse).
// For slow operations (RAM alloc, code compilation) Chrome may time out
// waiting for the GATT Write Response, but the hub DID process the command.
async function pbWrite(char, data, label, addOutput) {
  try {
    await char.writeValue(data instanceof Uint8Array ? data : new Uint8Array(data))
    addOutput && addOutput(`  ✓ ${label}`)
  } catch (e) {
    addOutput && addOutput(`  ⚠ ${label} (${e.message}) — hub may still have processed it`)
  }
}

// ── Send bytes to REPL stdin via WRITE_STDIN (command 0x06) ──
// One call per chunk; max payload = max_char_size - 1 bytes.
async function writeStdin(pbChar, bytes, label, addOutput) {
  const packet = new Uint8Array(1 + bytes.length)
  packet[0] = CMD_WRITE_STDIN
  packet.set(bytes, 1)
  await pbWrite(pbChar, packet, label, addOutput)
}

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const pbCharRef   = useRef(null)
  const deviceRef   = useRef(null)
  const maxCharRef  = useRef(512)
  const nusBufRef   = useRef('')  // NUS TX line buffer

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handlePbNotification = useCallback((event) => {
    const d     = new Uint8Array(event.target.value.buffer)
    if (d[0] === EVT_STATUS_REPORT && d.length >= 5) {
      const flags   = new DataView(d.buffer).getUint32(1, true)
      const running = (flags & 0x0100) !== 0
      setStatus(running ? 'running' : 'connected')
    }
  }, [])

  // ── NUS TX — REPL stdout/stderr comes here ─────────────────
  // Buffer incomplete lines so split NUS packets show as whole lines.
  const handleNusTx = useCallback((event) => {
    const d    = new Uint8Array(event.target.value.buffer)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(d)
    nusBufRef.current += text

    const lines = nusBufRef.current.split('\n')
    nusBufRef.current = lines.pop()  // keep trailing incomplete line

    for (const raw of lines) {
      const line = raw
        .replace(/\r/g, '')
        .replace(/\x04/g, '')     // EOT markers
      // Skip REPL noise (prompts, raw mode banner)
      if (line === '>' || line === 'OK' || line === '') continue
      if (line.startsWith('raw REPL')) continue
      if (line.startsWith('>>>')) continue
      if (line.startsWith('...')) continue
      addOutput(line)
    }
  }, [addOutput])

  // ── connect ───────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg('Web Bluetooth requires Chrome or Edge on desktop.')
      return
    }
    setStatus('connecting'); setErrorMsg(null); setOutput([])
    nusBufRef.current = ''

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters:          [{ services: [PYBRICKS_SERVICE_UUID] }],
        optionalServices: [PYBRICKS_SERVICE_UUID, PYBRICKS_CAPABILITIES_UUID, NUS_SERVICE_UUID],
      })
      deviceRef.current = device
      setHubName(device.name || 'Hub')
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected'); setHubName(null); pbCharRef.current = null
        addOutput('⚠ Disconnected.')
      })

      const server = await device.gatt.connect()
      const pbSvc  = await server.getPrimaryService(PYBRICKS_SERVICE_UUID)

      try {
        const capChar = await pbSvc.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        const cv      = new DataView(capVal.buffer)
        maxCharRef.current = cv.getUint16(0, true)
        const flags   = capVal.byteLength >= 6 ? cv.getUint32(2, true) : 0
        addOutput(`✓ max_write=${maxCharRef.current}B caps=0x${flags.toString(16)}`)
      } catch (e) { addOutput(`⚠ caps: ${e.message}`) }

      const pbChar = await pbSvc.getCharacteristic(PYBRICKS_CHAR_UUID)
      pbCharRef.current = pbChar
      await pbChar.startNotifications()
      pbChar.addEventListener('characteristicvaluechanged', handlePbNotification)

      // NUS TX (hub → browser) for REPL output
      try {
        const nusSvc = await server.getPrimaryService(NUS_SERVICE_UUID)
        const nusTx  = await nusSvc.getCharacteristic(NUS_TX_UUID)
        await nusTx.startNotifications()
        nusTx.addEventListener('characteristicvaluechanged', handleNusTx)
        addOutput('✓ NUS TX connected (REPL output)')
      } catch (e) { addOutput(`⚠ NUS: ${e.message}`) }

      setStatus('connected')
      addOutput(`✓ Connected to ${device.name || 'Hub'}`)
    } catch (err) {
      if (err.name !== 'NotFoundError') { setStatus('error'); setErrorMsg(err.message) }
      else setStatus('disconnected')
    }
  }, [handlePbNotification, handleNusTx])

  const disconnect = useCallback(async () => {
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect()
    setStatus('disconnected'); setHubName(null); pbCharRef.current = null
  }, [])

  const stop = useCallback(async () => {
    if (!pbCharRef.current) return
    try {
      await pbWrite(pbCharRef.current, [CMD_STOP_USER_PROGRAM], 'STOP', addOutput)
      // Also send Ctrl+C to interrupt any REPL operation
      await writeStdin(pbCharRef.current, new Uint8Array([CTRL_C]), 'CTRL_C', null)
      setStatus('connected'); addOutput('⏹ Stopped.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop: ' + e.message) }
  }, [addOutput])

  // ── run via REPL + WRITE_STDIN ────────────────────────────
  const run = useCallback(async (pythonCode) => {
    if (!pbCharRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)
    nusBufRef.current = ''
    setStatus('running')

    const pb = pbCharRef.current

    try {
      // 1. Stop any running program
      addOutput('⏹ Stopping...')
      await pbWrite(pb, [CMD_STOP_USER_PROGRAM], 'STOP', null)
      await delay(600)

      // 2. Enter REPL mode
      addOutput('▶ Starting REPL...')
      await pbWrite(pb, [CMD_START_REPL], 'START_REPL', null)
      await delay(1000)  // wait for REPL banner to appear

      // 3. Ctrl+A: enter MicroPython raw mode via WRITE_STDIN
      //    Hub responds with "raw REPL; CTRL-B to exit" via NUS TX
      addOutput('  Entering raw mode (WRITE_STDIN)...')
      await writeStdin(pb, new Uint8Array([CTRL_A]), 'CTRL_A', null)
      await delay(500)

      // 4. Send Python source code via WRITE_STDIN
      //    max payload = maxCharRef.current - 1 bytes per call
      const codeBytes  = new TextEncoder().encode(pythonCode)
      const maxPayload = maxCharRef.current - 1  // 511 bytes

      addOutput(`  Sending ${codeBytes.length}B Python source...`)
      for (let off = 0; off < codeBytes.length; off += maxPayload) {
        const chunk = codeBytes.slice(off, off + maxPayload)
        await writeStdin(pb, chunk, `code[${off}]`, null)
        await delay(50)
      }

      // 5. Ctrl+D: execute the buffered code
      //    Hub compiles + runs; output arrives via NUS TX
      addOutput('─────────────────')
      await writeStdin(pb, new Uint8Array([CTRL_D]), 'CTRL_D (execute)', null)

      // Status will update to 'connected' when program finishes
    } catch (e) {
      setStatus('error'); setErrorMsg('Run: ' + e.message)
      addOutput('✗ ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
