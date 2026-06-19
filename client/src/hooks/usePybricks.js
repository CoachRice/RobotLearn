// client/src/hooks/usePybricks.js
// Protocol reference: https://docs.pybricks.com/projects/pybricksdev/en/latest/api/ble/pybricks.html
import { useState, useCallback, useRef } from 'react'

// ── UUIDs ────────────────────────────────────────────────────
const PYBRICKS_SERVICE_UUID = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID    = 'c5f50002-8280-46da-89f4-6d8051e4aeef'

// ── Official command bytes ────────────────────────────────────
// Source: pybricksdev Command enum (protocol v1.2+)
const CMD_STOP_USER_PROGRAM       = 0x00  // Stop the user program
const CMD_START_USER_PROGRAM      = 0x01  // Start the user program
const CMD_WRITE_USER_PROGRAM_META = 0x03  // Write program SIZE (4 bytes LE) — MUST come before data
const CMD_WRITE_USER_RAM          = 0x04  // Write data chunk: [0x04, offset (4 LE), data...]

// ── Official event bytes ──────────────────────────────────────
const EVT_STATUS_REPORT = 0x00  // 32-bit LE status flags follow
const EVT_WRITE_STDOUT  = 0x01  // Print output from hub follows

// ── Max bytes per BLE write (header 5 bytes + data) ──────────
const MAX_CHUNK = 512

// ── Extract MPY bytes from compile() result ───────────────────
// compile() returns { status, mpy: Uint8Array, out, err }
function extractMpy(result) {
  if (result instanceof Uint8Array)         return result
  if (result?.mpy instanceof Uint8Array)    return result.mpy
  if (result?.output instanceof Uint8Array) return result.output
  if (result instanceof ArrayBuffer)        return new Uint8Array(result)
  throw new Error(
    'Unexpected compile result: ' + JSON.stringify(Object.keys(result || {})) +
    '. Check browser console.'
  )
}

async function compilePython(pythonCode) {
  const compilePromise = import('@pybricks/mpy-cross-v6').then(
    async ({ compile }) => {
      const raw = await compile('user_program.py', pythonCode, undefined, '/mpy-cross-v6.wasm')
      return extractMpy(raw)
    }
  )
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Compilation timed out — check browser console')), 15000)
  )
  return Promise.race([compilePromise, timeout])
}

const delay = ms => new Promise(r => setTimeout(r, ms))

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const deviceRef = useRef(null)
  const charRef   = useRef(null)

  const addOutput = useCallback((line) => {
    setOutput(prev => [...prev, line])
  }, [])

  const handleNotification = useCallback((event) => {
    const data      = new Uint8Array(event.target.value.buffer)
    const eventType = data[0]

    if (eventType === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(data.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (eventType === EVT_STATUS_REPORT) {
      // Status flags are a 32-bit LE integer in bytes 1-4
      const flags = new DataView(data.buffer).getUint32(1, true)
      // Bit 0 = user program running (from StatusFlag enum)
      const running = (flags & 0x01) !== 0
      setStatus(running ? 'running' : 'connected')
    }
  }, [addOutput])

  // ── connect ───────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg('Web Bluetooth not supported. Use Chrome or Edge on desktop.')
      return
    }
    setStatus('connecting'); setErrorMsg(null); setOutput([])
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [PYBRICKS_SERVICE_UUID] }],
        optionalServices: [PYBRICKS_SERVICE_UUID],
      })
      deviceRef.current = device
      setHubName(device.name || 'Pybricks Hub')
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected'); setHubName(null); charRef.current = null
        addOutput('⚠ Hub disconnected.')
      })
      const server  = await device.gatt.connect()
      const service = await server.getPrimaryService(PYBRICKS_SERVICE_UUID)
      const char    = await service.getCharacteristic(PYBRICKS_CHAR_UUID)
      charRef.current = char
      await char.startNotifications()
      char.addEventListener('characteristicvaluechanged', handleNotification)
      setStatus('connected')
      addOutput(`✓ Connected to ${device.name || 'Pybricks Hub'}`)
    } catch (err) {
      if (err.name !== 'NotFoundError') { setStatus('error'); setErrorMsg(err.message) }
      else setStatus('disconnected')
    }
  }, [handleNotification, addOutput])

  // ── disconnect ────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect()
    setStatus('disconnected'); setHubName(null); charRef.current = null
  }, [])

  // ── stop ──────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!charRef.current) return
    try {
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_STOP_USER_PROGRAM]))
      setStatus('connected'); addOutput('⏹ Program stopped.')
    } catch (err) { setStatus('error'); setErrorMsg('Stop failed: ' + err.message) }
  }, [addOutput])

  // ── run ───────────────────────────────────────────────────
  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error'); setErrorMsg('Not connected. Click Connect first.'); return
    }
    setOutput([]); setErrorMsg(null)

    // Step 1: Compile
    setStatus('compiling'); addOutput('⚙ Compiling Python...')
    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ Compiled (${mpy.length} bytes)`)
    } catch (err) {
      setStatus('error'); setErrorMsg(err.message); addOutput('✗ ' + err.message); return
    }

    setStatus('uploading'); addOutput('⬆ Uploading to hub...')
    try {
      // Step 2: Stop any currently running program
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_STOP_USER_PROGRAM]))
      await delay(300)

      // Step 3: Write program SIZE metadata — hub uses this to allocate RAM
      // Format: [0x03, size as 4-byte little-endian uint32]
      const meta = new Uint8Array(5)
      meta[0] = CMD_WRITE_USER_PROGRAM_META
      new DataView(meta.buffer).setUint32(1, mpy.length, true)
      await charRef.current.writeValueWithoutResponse(meta)
      await delay(100)

      // Step 4: Write program data in chunks
      // Format: [0x04, offset as 4-byte little-endian uint32, data bytes...]
      let offset = 0
      while (offset < mpy.length) {
        const chunkSize = Math.min(MAX_CHUNK - 5, mpy.length - offset)
        const chunk  = mpy.slice(offset, offset + chunkSize)
        const packet = new Uint8Array(5 + chunkSize)
        packet[0] = CMD_WRITE_USER_RAM
        new DataView(packet.buffer).setUint32(1, offset, true)
        packet.set(chunk, 5)
        await charRef.current.writeValueWithoutResponse(packet)
        offset += chunkSize
        await delay(60)
      }
      addOutput('✓ Upload complete')
    } catch (err) {
      setStatus('error'); setErrorMsg('Upload failed: ' + err.message)
      addOutput('✗ Upload failed — try reconnecting.'); return
    }

    // Step 5: Start program
    setStatus('running'); addOutput('▶ Running...')
    addOutput('─────────────────')
    try {
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_START_USER_PROGRAM]))
    } catch (err) {
      setStatus('error'); setErrorMsg('Start failed: ' + err.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
