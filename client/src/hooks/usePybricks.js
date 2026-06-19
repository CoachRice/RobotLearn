// client/src/hooks/usePybricks.js
// Diagnostic: zero filtering on NUS output, explicit raw-mode reset sequence
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'
const NUS_SERVICE_UUID           = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const NUS_TX_UUID                = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

const CMD_STOP_USER_PROGRAM = 0x00
const CMD_START_REPL        = 0x02
const CMD_WRITE_STDIN       = 0x06

const CTRL_B = 0x02  // exit raw mode → back to friendly REPL
const CTRL_C = 0x03  // interrupt
const CTRL_A = 0x01  // enter raw mode
const CTRL_D = 0x04  // execute (raw mode) / soft reboot (friendly mode)

const EVT_STATUS_REPORT = 0x00

const delay = ms => new Promise(r => setTimeout(r, ms))

async function pbWrite(char, data, label, addOutput) {
  try {
    await char.writeValue(data instanceof Uint8Array ? data : new Uint8Array(data))
    if (addOutput) addOutput(`  ✓ sent: ${label}`)
  } catch (e) {
    if (addOutput) addOutput(`  ⚠ FAILED: ${label} — ${e.message}`)
    throw e
  }
}

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

  const pbCharRef  = useRef(null)
  const deviceRef  = useRef(null)
  const maxCharRef = useRef(512)

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handlePbNotification = useCallback((event) => {
    const d = new Uint8Array(event.target.value.buffer)

    // EVT_WRITE_STDOUT (0x01) — this is the OFFICIAL output channel for
    // anything sent via WRITE_STDIN. We had stopped listening to this
    // when we pivoted to NUS — that was the bug.
    if (d[0] === 0x01) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(d.slice(1))
      const hex  = Array.from(d).map(b => b.toString(16).padStart(2,'0')).join(' ')
      addOutput(`PB-STDOUT: [${hex}] "${text.replace(/\r/g,'\\r').replace(/\n/g,'\\n')}"`)
    }

    if (d[0] === EVT_STATUS_REPORT && d.length >= 5) {
      const flags   = new DataView(d.buffer).getUint32(1, true)
      const running = (flags & 0x0100) !== 0
      addOutput(`  [PB status: 0x${flags.toString(16)} running=${running}]`)
      setStatus(running ? 'running' : 'connected')
    }
  }, [addOutput])

  // ── NUS TX — raw, unfiltered, immediate ───────────────────
  // No buffering, no line-splitting, no filtering.
  // Every single notification is shown exactly as received.
  const handleNusTx = useCallback((event) => {
    const d    = new Uint8Array(event.target.value.buffer)
    const hex  = Array.from(d).map(b => b.toString(16).padStart(2,'0')).join(' ')
    const text = new TextDecoder('utf-8', { fatal: false }).decode(d)
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n')
    addOutput(`NUS: [${hex}] "${text}"`)
  }, [addOutput])

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
        maxCharRef.current = new DataView(capVal.buffer).getUint16(0, true)
        addOutput(`✓ max_write=${maxCharRef.current}B`)
      } catch (e) { addOutput(`⚠ caps: ${e.message}`) }

      const pbChar = await pbSvc.getCharacteristic(PYBRICKS_CHAR_UUID)
      pbCharRef.current = pbChar
      await pbChar.startNotifications()
      pbChar.addEventListener('characteristicvaluechanged', handlePbNotification)

      try {
        const nusSvc = await server.getPrimaryService(NUS_SERVICE_UUID)
        const nusTx  = await nusSvc.getCharacteristic(NUS_TX_UUID)
        await nusTx.startNotifications()
        nusTx.addEventListener('characteristicvaluechanged', handleNusTx)
        addOutput('✓ NUS TX connected')
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
      setStatus('connected'); addOutput('⏹ Stopped.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop: ' + e.message) }
  }, [addOutput])

  // ── run ───────────────────────────────────────────────────
  const run = useCallback(async (pythonCode) => {
    if (!pbCharRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)
    setStatus('running')
    const pb = pbCharRef.current

    try {
      // 1. STOP — interrupt any running user program
      addOutput('━━ Step 1: STOP ━━')
      await pbWrite(pb, [CMD_STOP_USER_PROGRAM], 'STOP', addOutput)
      await delay(500)

      // 2. RESET REPL STATE — exit any stuck raw mode, then interrupt
      //    This handles the hub being left in an unknown REPL state
      //    from a previous attempt.
      addOutput('━━ Step 2: Reset REPL state ━━')
      await writeStdin(pb, new Uint8Array([CTRL_B]), 'CTRL_B (exit raw mode)', addOutput)
      await delay(300)
      await writeStdin(pb, new Uint8Array([CTRL_C]), 'CTRL_C (interrupt)', addOutput)
      await delay(300)

      // 3. START REPL — ensure hub is in interactive REPL
      addOutput('━━ Step 3: START_REPL ━━')
      await pbWrite(pb, [CMD_START_REPL], 'START_REPL', addOutput)
      await delay(1200)  // wait for banner

      // 4. Ctrl+A — enter raw mode
      addOutput('━━ Step 4: Enter raw mode ━━')
      await writeStdin(pb, new Uint8Array([CTRL_A]), 'CTRL_A', addOutput)
      await delay(600)

      // 5. Send code
      addOutput('━━ Step 5: Send code ━━')
      const codeBytes  = new TextEncoder().encode(pythonCode)
      const maxPayload = maxCharRef.current - 1
      let chunkNum = 0
      for (let off = 0; off < codeBytes.length; off += maxPayload) {
        const chunk = codeBytes.slice(off, off + maxPayload)
        chunkNum++
        await writeStdin(pb, chunk, `code chunk ${chunkNum} (${chunk.length}B)`, addOutput)
        await delay(60)
      }

      // 6. Ctrl+D — execute
      addOutput('━━ Step 6: Execute (CTRL_D) ━━')
      await writeStdin(pb, new Uint8Array([CTRL_D]), 'CTRL_D', addOutput)

      addOutput('━━ Waiting for hub response... ━━')
    } catch (e) {
      setStatus('error'); setErrorMsg('Run: ' + e.message)
      addOutput('✗ ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
