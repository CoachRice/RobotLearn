// client/src/hooks/usePybricks.js
// Diagnostic version: logs char properties and tries writeValue for all writes
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'
const NUS_SERVICE_UUID           = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const NUS_RX_UUID                = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const NUS_TX_UUID                = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

const CMD_STOP_USER_PROGRAM = 0x00
const CMD_START_REPL        = 0x02
const CTRL_C = 0x03
const CTRL_A = 0x01
const CTRL_D = 0x04

const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Write with response; on GATT error log it and keep going ─
// Some hub operations (RAM allocation) are slow enough that Chrome
// times out waiting for the GATT Write Response.  The hub DID
// process the command; we just never saw the acknowledgement.
async function writeSafe(char, data, label, addOutput) {
  try {
    if (char.properties.write) {
      await char.writeValue(data)
      addOutput && addOutput(`  ✓ ${label}`)
    } else {
      await char.writeValueWithoutResponse(data)
      addOutput && addOutput(`  → ${label} (no-response)`)
    }
  } catch (e) {
    // Log but continue — Chrome timeout does not mean the hub failed
    addOutput && addOutput(`  ⚠ ${label} GATT: ${e.message}`)
  }
}

function propsStr(p) {
  const flags = []
  if (p.read)                 flags.push('read')
  if (p.write)                flags.push('write')
  if (p.writeWithoutResponse) flags.push('writeNoRsp')
  if (p.notify)               flags.push('notify')
  if (p.indicate)             flags.push('indicate')
  return flags.join('|') || 'none'
}

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const pbCharRef  = useRef(null)
  const nusRxRef   = useRef(null)
  const deviceRef  = useRef(null)
  const maxCharRef = useRef(512)

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handlePbNotification = useCallback((event) => {
    const d = new Uint8Array(event.target.value.buffer)
    if (d[0] === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(d.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (d[0] === EVT_STATUS_REPORT && d.length >= 5) {
      const flags   = new DataView(d.buffer).getUint32(1, true)
      const running = (flags & 0x0100) !== 0
      addOutput(`  [status 0x${flags.toString(16)} running:${running}]`)
      setStatus(running ? 'running' : 'connected')
    }
  }, [addOutput])

  const handleNusTx = useCallback((event) => {
    const d    = new Uint8Array(event.target.value.buffer)
    const hex  = Array.from(d).map(b => b.toString(16).padStart(2,'0')).join(' ')
    const text = new TextDecoder('utf-8', { fatal: false }).decode(d)
      .replace(/\x04/g, '[EOT]')
      .replace(/\r/g, '')
    addOutput(`  NUS← hex:[${hex}] text:"${text}"`)
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
        setStatus('disconnected'); setHubName(null)
        pbCharRef.current = null; nusRxRef.current = null
        addOutput('⚠ Disconnected.')
      })
      const server = await device.gatt.connect()

      // PyBricks
      const pbSvc  = await server.getPrimaryService(PYBRICKS_SERVICE_UUID)
      try {
        const capChar = await pbSvc.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        const cv      = new DataView(capVal.buffer)
        maxCharRef.current = cv.getUint16(0, true)
        const flags   = capVal.byteLength >= 6  ? cv.getUint32(2, true) : 0
        addOutput(`✓ caps: max=${maxCharRef.current}B flags=0x${flags.toString(16)}`)
      } catch (e) { addOutput(`⚠ caps: ${e.message}`) }

      const pbChar = await pbSvc.getCharacteristic(PYBRICKS_CHAR_UUID)
      pbCharRef.current = pbChar
      addOutput(`  PB char props: ${propsStr(pbChar.properties)}`)
      await pbChar.startNotifications()
      pbChar.addEventListener('characteristicvaluechanged', handlePbNotification)

      // NUS
      try {
        const nusSvc = await server.getPrimaryService(NUS_SERVICE_UUID)
        const nusTx  = await nusSvc.getCharacteristic(NUS_TX_UUID)
        const nusRx  = await nusSvc.getCharacteristic(NUS_RX_UUID)
        addOutput(`  NUS TX props: ${propsStr(nusTx.properties)}`)
        addOutput(`  NUS RX props: ${propsStr(nusRx.properties)}`)
        await nusTx.startNotifications()
        nusTx.addEventListener('characteristicvaluechanged', handleNusTx)
        nusRxRef.current = nusRx
        addOutput('✓ NUS connected')
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
    setStatus('disconnected'); setHubName(null)
    pbCharRef.current = null; nusRxRef.current = null
  }, [])

  const stop = useCallback(async () => {
    if (!pbCharRef.current) return
    await writeSafe(pbCharRef.current, new Uint8Array([CMD_STOP_USER_PROGRAM]), 'STOP', addOutput)
    if (nusRxRef.current) {
      await writeSafe(nusRxRef.current, new Uint8Array([CTRL_C]), 'CTRL_C via NUS', addOutput)
    }
    setStatus('connected'); addOutput('⏹ Stopped.')
  }, [addOutput])

  const run = useCallback(async (pythonCode) => {
    if (!pbCharRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)
    setStatus('running')

    addOutput('▶ Run sequence:')
    try {
      // 1. Stop
      await writeSafe(pbCharRef.current, new Uint8Array([CMD_STOP_USER_PROGRAM]),
        'STOP(0x00) via PB', addOutput)
      await delay(500)

      // 2. Start REPL
      await writeSafe(pbCharRef.current, new Uint8Array([CMD_START_REPL]),
        'START_REPL(0x02) via PB', addOutput)
      await delay(1000)

      if (!nusRxRef.current) {
        addOutput('✗ NUS RX not available')
        setStatus('connected'); return
      }

      // 3. Ctrl+C to interrupt any current REPL
      await writeSafe(nusRxRef.current, new Uint8Array([CTRL_C]),
        'CTRL_C(0x03) via NUS', addOutput)
      await delay(300)

      // 4. Ctrl+A for raw mode
      await writeSafe(nusRxRef.current, new Uint8Array([CTRL_A]),
        'CTRL_A(0x01) via NUS', addOutput)
      await delay(500)

      // 5. Send code in 20-byte chunks (safe NUS minimum)
      const codeBytes = new TextEncoder().encode(pythonCode)
      addOutput(`  Sending ${codeBytes.length}B code in 20B chunks...`)
      for (let off = 0; off < codeBytes.length; off += 20) {
        const chunk = codeBytes.slice(off, off + 20)
        await writeSafe(nusRxRef.current, chunk,
          `code[${off}..${off+chunk.length}]`, null)  // no logging for every chunk
        await delay(30)
      }
      addOutput('  ✓ Code sent')

      // 6. Ctrl+D to execute
      await writeSafe(nusRxRef.current, new Uint8Array([CTRL_D]),
        'CTRL_D(0x04) via NUS', addOutput)

      addOutput('─────────────────')
      addOutput('(waiting for hub output via NUS TX...)')
    } catch (e) {
      setStatus('error'); setErrorMsg(e.message); addOutput('✗ ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
