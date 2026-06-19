// client/src/hooks/usePybricks.js
// Uses the PyBricks REPL (HAS_REPL capability) to run code directly,
// bypassing the compile-and-upload protocol entirely.
// The hub compiles Python source itself; we just send text via WRITE_STDIN.
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

// Commands
const CMD_STOP_USER_PROGRAM  = 0x00  // stop any running program
const CMD_START_REPL         = 0x02  // enter interactive REPL
const CMD_WRITE_STDIN        = 0x06  // write bytes to REPL stdin

// MicroPython raw-REPL control bytes
const CTRL_C = 0x03   // interrupt
const CTRL_A = 0x01   // enter raw mode
const CTRL_D = 0x04   // execute (raw mode) / soft-reboot

// Events
const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Send bytes to hub stdin via WRITE_STDIN command ──────────
// Splits into chunks if necessary (max write size from capabilities)
async function writeStdin(char, bytes, maxPayload) {
  for (let off = 0; off < bytes.length; off += maxPayload) {
    const chunk  = bytes.slice(off, off + maxPayload)
    const packet = new Uint8Array(1 + chunk.length)
    packet[0] = CMD_WRITE_STDIN
    packet.set(chunk, 1)
    await char.writeValueWithoutResponse(packet)
    await delay(40)
  }
}

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const charRef    = useRef(null)
  const deviceRef  = useRef(null)
  const maxCharRef = useRef(512)

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handleNotification = useCallback((event) => {
    const d = new Uint8Array(event.target.value.buffer)
    if (d[0] === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(d.slice(1))
      // filter out MicroPython raw-REPL control sequences and echo
      const clean = text
        .replace(/\x04/g, '')           // Ctrl+D echo
        .replace(/raw REPL.*\r\n/g, '') // raw mode banner
        .replace(/^>+/gm, '')           // REPL prompt
        .replace(/\r/g, '')             // carriage returns
      clean.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (d[0] === EVT_STATUS_REPORT && d.length >= 5) {
      const flags   = new DataView(d.buffer).getUint32(1, true)
      const running = (flags & 0x0100) !== 0
      setStatus(running ? 'running' : 'connected')
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
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters:          [{ services: [PYBRICKS_SERVICE_UUID] }],
        optionalServices: [PYBRICKS_SERVICE_UUID, PYBRICKS_CAPABILITIES_UUID],
      })
      deviceRef.current = device
      setHubName(device.name || 'Pybricks Hub')
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected'); setHubName(null); charRef.current = null
        addOutput('⚠ Hub disconnected.')
      })
      const server  = await device.gatt.connect()
      const service = await server.getPrimaryService(PYBRICKS_SERVICE_UUID)

      try {
        const capChar = await service.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        const cv      = new DataView(capVal.buffer)
        maxCharRef.current = cv.getUint16(0, true)
        const flags   = capVal.byteLength >= 6  ? cv.getUint32(2, true) : 0
        const maxProg = capVal.byteLength >= 10 ? cv.getUint32(6, true) : 0
        const hasRepl = (flags & 0x01) !== 0
        addOutput(`✓ max_write:${maxCharRef.current}B | caps:0x${flags.toString(16)} | REPL:${hasRepl}`)
      } catch (e) {
        addOutput(`⚠ caps: ${e.message}`)
      }

      const char = await service.getCharacteristic(PYBRICKS_CHAR_UUID)
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
      // Send Ctrl+C via stdin to interrupt any running code
      await writeStdin(charRef.current, new Uint8Array([CTRL_C]), maxCharRef.current - 1)
      setStatus('connected'); addOutput('⏹ Interrupted.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop: ' + e.message) }
  }, [addOutput])

  // ── run via REPL ──────────────────────────────────────────
  // Sends Python source to the hub's built-in interpreter.
  // No compilation or blob format needed.
  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)

    const maxPayload = maxCharRef.current - 1  // 1 byte for WRITE_STDIN command

    setStatus('running'); addOutput('▶ Starting REPL...')

    try {
      // 1. Stop any running program
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_STOP_USER_PROGRAM]))
      await delay(400)

      // 2. Start the REPL
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_START_REPL]))
      await delay(800)  // give REPL time to initialise

      // 3. Enter MicroPython raw mode (Ctrl+A)
      //    Hub will echo "raw REPL; CTRL-B to exit\r\n>"
      addOutput('  Entering raw mode...')
      await writeStdin(charRef.current, new Uint8Array([CTRL_A]), maxPayload)
      await delay(400)

      // 4. Send the Python source code
      const codeBytes = new TextEncoder().encode(pythonCode)
      addOutput(`  Sending ${codeBytes.length}B of Python source...`)
      await writeStdin(charRef.current, codeBytes, maxPayload)
      await delay(200)

      // 5. Execute with Ctrl+D
      //    MicroPython raw mode compiles and runs on Ctrl+D
      addOutput('  Executing...')
      addOutput('─────────────────')
      await writeStdin(charRef.current, new Uint8Array([CTRL_D]), maxPayload)

    } catch (e) {
      setStatus('error'); setErrorMsg('REPL error: ' + e.message)
      addOutput('✗ ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}