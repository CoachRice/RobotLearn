// client/src/hooks/usePybricks.js
import { useState, useCallback, useRef } from 'react'

// ── PyBricks BLE Protocol Constants ─────────────────────────
const PYBRICKS_SERVICE_UUID = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID    = 'c5f50002-8280-46da-89f4-6d8051e4aeef'

const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

const CMD_STOP_PROGRAM  = 0x00
const CMD_START_PROGRAM = 0x0D
const CMD_WRITE_PROGRAM = 0x06

const MAX_CHUNK_BYTES = 512

// ── Compile Python → MPY bytecode ────────────────────────────
// Uses a DYNAMIC import so Vite 8 / rolldown handles the WASM
// package at runtime rather than trying to bundle it at build time.
// A 15-second timeout surfaces a clear error if WASM fails to load.
async function compilePython(pythonCode) {
  const compilePromise = import('@pybricks/mpy-cross-v6').then(
    ({ compile }) => compile(
      'user_program.py',
      pythonCode,
      undefined,
      '/mpy-cross-v6.wasm'   // ← tell it exactly where the file is
    )
  )
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Compilation timed out after 15 s.')), 15000)
  )
  return Promise.race([compilePromise, timeoutPromise])
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

  const handleNotification = useCallback((event) => {
    const data      = new Uint8Array(event.target.value.buffer)
    const eventType = data[0]

    if (eventType === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(data.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (eventType === EVT_STATUS_REPORT) {
      const running = (data[1] & 0x01) !== 0
      setStatus(running ? 'running' : 'connected')
    }
  }, [addOutput])

  // ── connect ───────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg(
        'Web Bluetooth is not supported. ' +
        'Please use Google Chrome or Microsoft Edge on a desktop computer.'
      )
      return
    }

    setStatus('connecting')
    setErrorMsg(null)
    setOutput([])

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [PYBRICKS_SERVICE_UUID] }],
        optionalServices: [PYBRICKS_SERVICE_UUID],
      })

      deviceRef.current = device
      setHubName(device.name || 'Pybricks Hub')

      device.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected')
        setHubName(null)
        charRef.current = null
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
      if (err.name !== 'NotFoundError') {
        setStatus('error')
        setErrorMsg(err.message)
      } else {
        setStatus('disconnected')
      }
    }
  }, [handleNotification, addOutput])

  // ── disconnect ────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect()
    }
    setStatus('disconnected')
    setHubName(null)
    charRef.current = null
  }, [])

  // ── stop ──────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!charRef.current) return
    try {
      await charRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_STOP_PROGRAM])
      )
      setStatus('connected')
      addOutput('⏹ Program stopped.')
    } catch (err) {
      setStatus('error')
      setErrorMsg('Could not stop program: ' + err.message)
    }
  }, [addOutput])

  // ── run ───────────────────────────────────────────────────
  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error')
      setErrorMsg('Not connected to a hub. Click Connect first.')
      return
    }

    setOutput([])
    setErrorMsg(null)

    // Step 1: Compile
    setStatus('compiling')
    addOutput('⚙ Compiling Python...')

    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ Compiled (${mpy.length} bytes)`)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err.message)
      addOutput('✗ ' + err.message)
      return
    }

    // Step 2: Upload
    setStatus('uploading')
    addOutput('⬆ Uploading to hub...')

    try {
      await charRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_STOP_PROGRAM])
      )
      await new Promise(r => setTimeout(r, 300))

      let offset = 0
      while (offset < mpy.length) {
        const chunkSize = Math.min(MAX_CHUNK_BYTES - 5, mpy.length - offset)
        const chunk     = mpy.slice(offset, offset + chunkSize)
        const packet    = new Uint8Array(5 + chunkSize)
        packet[0] = CMD_WRITE_PROGRAM
        new DataView(packet.buffer).setUint32(1, offset, true)
        packet.set(chunk, 5)
        await charRef.current.writeValueWithoutResponse(packet)
        offset += chunkSize
        await new Promise(r => setTimeout(r, 50))
      }

      addOutput('✓ Upload complete')
    } catch (err) {
      setStatus('error')
      setErrorMsg('Upload failed: ' + err.message)
      addOutput('✗ Upload failed — try reconnecting.')
      return
    }

    // Step 3: Start
    setStatus('running')
    addOutput('▶ Running...')
    addOutput('─────────────────')

    try {
      await charRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_START_PROGRAM])
      )
    } catch (err) {
      setStatus('error')
      setErrorMsg('Could not start program: ' + err.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
