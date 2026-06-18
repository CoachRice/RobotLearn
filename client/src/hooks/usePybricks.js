// client/src/hooks/usePybricks.js
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID    = 'c5f50002-8280-46da-89f4-6d8051e4aeef'

const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

// ── Extract MPY bytes from whatever compile() returns ─────────
// The @pybricks/mpy-cross-v6 package may return a Uint8Array
// directly, or wrap it in an object. This function handles both.
function extractMpy(result) {
  console.log('[PyBricks] compile() returned:', result, typeof result)

  if (result instanceof Uint8Array)        return result
  if (result?.mpy instanceof Uint8Array)   return result.mpy
  if (result?.output instanceof Uint8Array) return result.output
  if (result?.data instanceof Uint8Array)  return result.data

  // ArrayBuffer → Uint8Array
  if (result instanceof ArrayBuffer)       return new Uint8Array(result)
  if (result?.buffer instanceof ArrayBuffer) return new Uint8Array(result.buffer)

  // Last resort: try to coerce (logs will show us what it is)
  console.warn('[PyBricks] Unrecognised compile result — trying Object.values:', Object.values(result || {}))
  const values = Object.values(result || {})
  for (const v of values) {
    if (v instanceof Uint8Array)  return v
    if (v instanceof ArrayBuffer) return new Uint8Array(v)
  }
  throw new Error('Cannot extract MPY bytes from compile result. Check browser console for the raw value.')
}

// ── Compile Python → MPY with a 15 s timeout ─────────────────
async function compilePython(pythonCode) {
  const compilePromise = import('@pybricks/mpy-cross-v6').then(
    async ({ compile }) => {
      const raw = await compile(
        'user_program.py',
        pythonCode,
        undefined,
        '/mpy-cross-v6.wasm'
      )
      return extractMpy(raw)
    }
  )
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Compilation timed out after 15 s — check browser console')), 15000)
  )
  return Promise.race([compilePromise, timeout])
}

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

  // ── Log ALL bytes received from the hub for debugging ────────
  const handleNotification = useCallback((event) => {
    const data      = new Uint8Array(event.target.value.buffer)
    const eventType = data[0]

    // Log every notification so we can see what the hub is saying
    console.log('[PyBricks] Hub notification:', Array.from(data).map(b => '0x' + b.toString(16).padStart(2,'0')).join(' '))

    if (eventType === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(data.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (eventType === EVT_STATUS_REPORT) {
      const running = (data[1] & 0x01) !== 0
      console.log('[PyBricks] Status report — running:', running, 'raw byte:', data[1])
      setStatus(running ? 'running' : 'connected')
    }
  }, [addOutput])

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

  const disconnect = useCallback(async () => {
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect()
    setStatus('disconnected'); setHubName(null); charRef.current = null
  }, [])

  const stop = useCallback(async () => {
    if (!charRef.current) return
    try {
      // Try 0x00 first (used in some protocol versions)
      await charRef.current.writeValueWithoutResponse(new Uint8Array([0x00]))
      setStatus('connected'); addOutput('⏹ Stop sent.')
    } catch (err) { setStatus('error'); setErrorMsg('Stop failed: ' + err.message) }
  }, [addOutput])

  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error'); setErrorMsg('Not connected. Click Connect first.'); return
    }
    setOutput([]); setErrorMsg(null)

    // ── Compile ───────────────────────────────────────────────
    setStatus('compiling'); addOutput('⚙ Compiling Python...')
    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ Compiled (${mpy.length} bytes)`)
      console.log('[PyBricks] MPY bytes (first 16):', Array.from(mpy.slice(0,16)))
    } catch (err) {
      setStatus('error'); setErrorMsg(err.message); addOutput('✗ ' + err.message); return
    }

    // ── Upload in chunks ──────────────────────────────────────
    // We try two approaches for the write command byte.
    // 0x01 = older protocol / simple programs
    // 0x06 = WRITE_USER_RAM in some protocol versions
    // Adjust CMD_WRITE if upload is rejected by the hub.
    const CMD_WRITE = 0x06
    const MAX_CHUNK = 512

    setStatus('uploading'); addOutput('⬆ Uploading to hub...')
    try {
      // Stop any running program
      await charRef.current.writeValueWithoutResponse(new Uint8Array([0x00]))
      await new Promise(r => setTimeout(r, 400))

      let offset = 0
      while (offset < mpy.length) {
        const chunkSize = Math.min(MAX_CHUNK - 5, mpy.length - offset)
        const chunk = mpy.slice(offset, offset + chunkSize)
        const packet = new Uint8Array(5 + chunkSize)
        packet[0] = CMD_WRITE
        new DataView(packet.buffer).setUint32(1, offset, true)
        packet.set(chunk, 5)
        console.log('[PyBricks] Writing chunk at offset', offset, '— first bytes:', Array.from(packet.slice(0,8)))
        await charRef.current.writeValueWithoutResponse(packet)
        offset += chunkSize
        await new Promise(r => setTimeout(r, 60))
      }
      addOutput('✓ Upload complete')
    } catch (err) {
      setStatus('error'); setErrorMsg('Upload failed: ' + err.message)
      addOutput('✗ Upload failed — try reconnecting.'); return
    }

    // ── Start program ─────────────────────────────────────────
    // Try 0x02 (START in some protocol versions).
    // If the program still doesn't run, check the console log for
    // hub responses and try 0x01 or 0x0D instead.
    const CMD_START = 0x01
    setStatus('running'); addOutput(`▶ Running... (CMD_START: ${CMD_START})`)
    addOutput('─────────────────')
    try {
      console.log('[PyBricks] Sending START command:', CMD_START)
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_START]))
    } catch (err) {
      setStatus('error'); setErrorMsg('Start failed: ' + err.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}