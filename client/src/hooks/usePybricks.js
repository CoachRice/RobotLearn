// client/src/hooks/usePybricks.js
// ─────────────────────────────────────────────────────────────
// React hook that manages the full PyBricks BLE connection:
//   connect()       → open Bluetooth device picker, connect to hub
//   disconnect()    → close connection
//   run(code)       → compile Python → upload to hub → start program
//   stop()          → stop the running program
//   output          → array of strings from print() calls on the hub
//   status          → 'disconnected' | 'connecting' | 'connected' |
//                     'compiling' | 'uploading' | 'running' | 'error'
//   hubName         → e.g. "Pybricks Hub"
//   errorMsg        → human-readable error if status === 'error'
//
// Requirements:
//   • Hub must have PyBricks firmware installed (via code.pybricks.com)
//   • Browser must be Chrome or Edge on desktop
//   • Page must be served over HTTPS (Vercel handles this)
// ─────────────────────────────────────────────────────────────
import { useState, useCallback, useRef } from 'react'
import { compile } from '@pybricks/mpy-cross-v6'

// ── PyBricks BLE UUIDs ───────────────────────────────────────
// These are fixed constants published in the PyBricks protocol spec.
// https://github.com/pybricks/technical-info/blob/master/pybricks-ble-profile.md
const PYBRICKS_SERVICE_UUID = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID    = 'c5f50002-8280-46da-89f4-6d8051e4aeef'

// ── Event types received from hub (first byte of notification) ─
const EVT_STATUS_REPORT = 0x00   // hub status changed
const EVT_WRITE_STDOUT  = 0x01   // hub is sending print() output

// ── Status report flags (second byte of STATUS_REPORT event) ──
const FLAG_IDLE    = 0  // no program running
const FLAG_RUNNING = 1  // user program is running

// ── Commands sent to hub (first byte of each write) ──────────
const CMD_STOP_PROGRAM     = 0x00  // stop the current user program
const CMD_START_PROGRAM    = 0x01  // start the uploaded user program
const CMD_WRITE_PROGRAM    = 0x06  // write a chunk of MPY bytecode to hub RAM
// Note: newer PyBricks firmware (≥ 3.5) may use different command bytes.
// If the hub does not respond to Run, check the firmware version and update
// CMD_START_PROGRAM to 0x0D if needed.

// ── Maximum bytes per BLE write ───────────────────────────────
// Most hubs accept up to 512 bytes per write. We use 512 to be safe.
// If you see upload errors, lower this to 128.
const MAX_CHUNK_BYTES = 512

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  // Refs hold the live BLE objects so they survive re-renders
  const deviceRef = useRef(null)
  const charRef   = useRef(null)

  // ── Append a line to the output console ──────────────────────
  const addOutput = useCallback((line) => {
    setOutput(prev => [...prev, line])
  }, [])

  // ── Handle notifications from the hub ─────────────────────────
  // Called every time the hub sends data back to the browser.
  const handleNotification = useCallback((event) => {
    const data     = new Uint8Array(event.target.value.buffer)
    const eventType = data[0]

    if (eventType === EVT_WRITE_STDOUT) {
      // Bytes after the first byte are UTF-8 encoded print() output
      const text = new TextDecoder().decode(data.slice(1))
      // Split on newlines so each print() call is its own line
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }

    if (eventType === EVT_STATUS_REPORT) {
      const flag = data[1]
      if (flag === FLAG_IDLE)    setStatus('connected')
      if (flag === FLAG_RUNNING) setStatus('running')
    }
  }, [addOutput])

  // ── connect ───────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg('Web Bluetooth is not supported in this browser. Please use Chrome or Edge on a desktop computer.')
      return
    }

    setStatus('connecting')
    setErrorMsg(null)
    setOutput([])

    try {
      // Show the browser's Bluetooth device picker.
      // Only hubs running PyBricks firmware will appear in the list.
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [PYBRICKS_SERVICE_UUID] }],
        optionalServices: [PYBRICKS_SERVICE_UUID],
      })

      deviceRef.current = device
      setHubName(device.name || 'Pybricks Hub')

      // Handle the hub disconnecting unexpectedly
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

      // Subscribe to notifications (print output + status updates)
      await char.startNotifications()
      char.addEventListener('characteristicvaluechanged', handleNotification)

      setStatus('connected')
      addOutput(`✓ Connected to ${device.name || 'Pybricks Hub'}`)
    } catch (err) {
      // User cancelled the picker or BLE failed
      if (err.name !== 'NotFoundError') {
        setStatus('error')
        setErrorMsg(err.message)
      } else {
        setStatus('disconnected')
      }
    }
  }, [handleNotification, addOutput])

  // ── disconnect ────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect()
    }
    setStatus('disconnected')
    setHubName(null)
    charRef.current = null
  }, [])

  // ── stop ──────────────────────────────────────────────────────
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

  // ── run ───────────────────────────────────────────────────────
  // Compiles Python code to MicroPython bytecode (.mpy) then
  // uploads it to the hub and starts it.
  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error')
      setErrorMsg('Not connected to a hub. Click Connect first.')
      return
    }

    setOutput([])  // clear previous output
    setErrorMsg(null)

    // ── Step 1: Compile Python → MPY bytecode ─────────────────
    setStatus('compiling')
    addOutput('⚙ Compiling...')
    let mpy
    try {
      mpy = await compile('user_program.py', pythonCode)
      addOutput(`✓ Compiled (${mpy.length} bytes)`)
    } catch (err) {
      setStatus('error')
      setErrorMsg('Compilation error: ' + err.message)
      addOutput('✗ Compilation failed — check your Python code for syntax errors.')
      return
    }

    // ── Step 2: Upload MPY to hub in chunks ───────────────────
    setStatus('uploading')
    addOutput('⬆ Uploading to hub...')
    try {
      // Stop any currently running program first
      await charRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_STOP_PROGRAM])
      )
      // Small pause to let the hub settle
      await new Promise(r => setTimeout(r, 200))

      // Send the MPY bytes in chunks, each prefixed with CMD_WRITE_PROGRAM
      // and a 4-byte little-endian offset indicating where in RAM to write.
      let offset = 0
      while (offset < mpy.length) {
        const chunkSize = Math.min(MAX_CHUNK_BYTES - 5, mpy.length - offset)
        const chunk     = mpy.slice(offset, offset + chunkSize)

        // Build the write packet: [CMD, offset (4 bytes LE), ...chunk data]
        const packet = new Uint8Array(5 + chunkSize)
        packet[0] = CMD_WRITE_PROGRAM
        new DataView(packet.buffer).setUint32(1, offset, true) // little-endian
        packet.set(chunk, 5)

        await charRef.current.writeValueWithoutResponse(packet)
        offset += chunkSize

        // Brief pause between chunks to avoid overwhelming the hub
        await new Promise(r => setTimeout(r, 50))
      }

      addOutput(`✓ Upload complete`)
    } catch (err) {
      setStatus('error')
      setErrorMsg('Upload failed: ' + err.message)
      addOutput('✗ Upload failed. Try reconnecting to the hub.')
      return
    }

    // ── Step 3: Start the program ─────────────────────────────
    setStatus('running')
    addOutput('▶ Running...')
    addOutput('─────────────────')
    try {
      await charRef.current.writeValueWithoutResponse(
        new Uint8Array([CMD_START_PROGRAM])
      )
      // Status will update to 'connected' via EVT_STATUS_REPORT
      // when the program finishes running on the hub.
    } catch (err) {
      setStatus('error')
      setErrorMsg('Could not start program: ' + err.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
