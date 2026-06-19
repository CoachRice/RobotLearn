// client/src/hooks/usePybricks.js
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

const CMD_STOP_USER_PROGRAM       = 0x00
const CMD_START_USER_PROGRAM      = 0x01
const CMD_WRITE_USER_PROGRAM_META = 0x03
const CMD_WRITE_USER_RAM          = 0x04

const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

// ── Capability flags (HubCapabilityFlag enum) ──────────────────
const CAP_HAS_REPL                     = 0x01
const CAP_USER_PROG_MULTI_FILE_MPY6    = 0x02
const CAP_USER_PROG_MPY6_1_NATIVE      = 0x04
const CAP_BUILTIN_PORT_VIEW            = 0x08
const CAP_BUILTIN_IMU_CALIBRATION      = 0x10
const CAP_USER_PROG_MULTI_MPY_V6_3     = 0x20

// ── Build multi-file blob ──────────────────────────────────────
// Format from hub flash dump (pybricks discussion #1567):
//   [file_count uint32 LE] [mpy_size uint32 LE] [__main__\0] [mpy data]
function createBlob(mpy) {
  const nameBytes = new TextEncoder().encode('__main__')
  const blob = new Uint8Array(4 + 4 + nameBytes.length + 1 + mpy.length)
  const dv   = new DataView(blob.buffer)
  let   off  = 0
  dv.setUint32(off, 1, true);           off += 4  // file_count = 1
  dv.setUint32(off, mpy.length, true);  off += 4  // mpy_size
  blob.set(nameBytes, off);             off += nameBytes.length
  blob[off++] = 0                                  // null terminator
  blob.set(mpy, off)
  return blob
}

async function compilePython(code) {
  const p = import('@pybricks/mpy-cross-v6').then(async ({ compile }) => {
    const r = await compile('__main__.py', code, undefined, '/mpy-cross-v6.wasm')
    if (r instanceof Uint8Array)         return r
    if (r?.mpy instanceof Uint8Array)    return r.mpy
    if (r?.output instanceof Uint8Array) return r.output
    throw new Error('Unknown compile result: ' + JSON.stringify(Object.keys(r || {})))
  })
  const t = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('Compile timed out')), 15000))
  return Promise.race([p, t])
}

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Write with response — throws GATT error if hub rejects ────
async function write(char, data) {
  // writeValue (with response) — hub sends back GATT error if it rejects the command
  // This is essential for debugging: writeValueWithoutResponse is silent on errors
  await char.writeValue(data)
}

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const charRef    = useRef(null)
  const deviceRef  = useRef(null)
  const maxCharRef = useRef(100)
  const capFlagsRef = useRef(0)

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handleNotification = useCallback((event) => {
    const d  = new Uint8Array(event.target.value.buffer)
    const ev = d[0]
    if (ev === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(d.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (ev === EVT_STATUS_REPORT && d.length >= 5) {
      const flags   = new DataView(d.buffer).getUint32(1, true)
      const running = (flags & 0x0100) !== 0
      setStatus(running ? 'running' : 'connected')
    }
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

      // ── Read full hub capabilities ──────────────────────────
      try {
        const capChar = await service.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        const cv      = new DataView(capVal.buffer)
        const maxChar      = cv.getUint16(0, true)
        const flags        = capVal.byteLength >= 6 ? cv.getUint32(2, true) : 0
        const maxProg      = capVal.byteLength >= 10 ? cv.getUint32(6, true) : 0
        maxCharRef.current  = maxChar
        capFlagsRef.current = flags

        const capNames = []
        if (flags & CAP_HAS_REPL)                  capNames.push('REPL')
        if (flags & CAP_USER_PROG_MULTI_FILE_MPY6)  capNames.push('MPY6-blob')
        if (flags & CAP_USER_PROG_MPY6_1_NATIVE)    capNames.push('MPY6.1-native')
        if (flags & CAP_USER_PROG_MULTI_MPY_V6_3)   capNames.push('MPY6.3-native')
        if (flags & CAP_BUILTIN_PORT_VIEW)           capNames.push('port-view')
        if (flags & CAP_BUILTIN_IMU_CALIBRATION)     capNames.push('imu-cal')

        addOutput(`✓ Max write: ${maxChar}B | Max prog: ${maxProg}B`)
        addOutput(`  Caps: 0x${flags.toString(16).toUpperCase()} [${capNames.join(', ') || 'none'}]`)
      } catch (e) {
        maxCharRef.current  = 100
        capFlagsRef.current = 0
        addOutput(`⚠ Caps unreadable (${e.message}), using defaults`)
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
      await write(charRef.current, new Uint8Array([CMD_STOP_USER_PROGRAM]))
      setStatus('connected'); addOutput('⏹ Stopped.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop failed: ' + e.message) }
  }, [addOutput])

  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error'); setErrorMsg('Not connected. Click Connect first.'); return
    }
    setOutput([]); setErrorMsg(null)

    const maxPayload = maxCharRef.current - 5
    const capFlags   = capFlagsRef.current
    addOutput(`ℹ Caps: 0x${capFlags.toString(16)} | Max write: ${maxCharRef.current}B`)

    // ── Compile ───────────────────────────────────────────────
    setStatus('compiling'); addOutput('⚙ Compiling...')
    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ Compiled: ${mpy.length}B`)
    } catch (e) {
      setStatus('error'); setErrorMsg(e.message); addOutput('✗ ' + e.message); return
    }

    // ── Build program blob ────────────────────────────────────
    const blob = createBlob(mpy)
    addOutput(`✓ Blob: ${blob.length}B [1+1+${mpy.length} files]`)

    // ── Upload ────────────────────────────────────────────────
    setStatus('uploading'); addOutput('⬆ Uploading...')
    try {
      // STOP — wait 800ms to ensure hub is idle before writing
      addOutput('  Sending STOP...')
      await write(charRef.current, new Uint8Array([CMD_STOP_USER_PROGRAM]))
      await delay(800)

      // META — tell hub total blob size; hub allocates RAM
      const meta = new Uint8Array(5)
      meta[0] = CMD_WRITE_USER_PROGRAM_META
      new DataView(meta.buffer).setUint32(1, blob.length, true)
      addOutput(`  Sending META (size=${blob.length})...`)
      await write(charRef.current, meta)
      await delay(500)

      // WRITE chunks
      let off = 0, chunks = 0
      while (off < blob.length) {
        const size   = Math.min(maxPayload, blob.length - off)
        const chunk  = blob.slice(off, off + size)
        const packet = new Uint8Array(5 + size)
        packet[0] = CMD_WRITE_USER_RAM
        new DataView(packet.buffer).setUint32(1, off, true)
        packet.set(chunk, 5)
        addOutput(`  WRITE chunk ${chunks + 1}: off=${off}, size=${size}`)
        await write(charRef.current, packet)
        off += size; chunks++
        await delay(100)
      }
      addOutput(`✓ Uploaded ${off}B in ${chunks} chunk${chunks > 1 ? 's' : ''}`)
      await delay(300)
    } catch (e) {
      // writeValue throws with GATT error code if hub rejects the command
      setStatus('error')
      setErrorMsg('Upload/command error: ' + e.message)
      addOutput('✗ GATT error: ' + e.message)
      addOutput('  This tells us exactly which command the hub rejected.')
      return
    }

    // ── START ─────────────────────────────────────────────────
    setStatus('running'); addOutput('▶ Sending START...')
    addOutput('─────────────────')
    try {
      await write(charRef.current, new Uint8Array([CMD_START_USER_PROGRAM]))
      addOutput('✓ START accepted by hub')
    } catch (e) {
      setStatus('error')
      setErrorMsg('START rejected: ' + e.message)
      addOutput('✗ START GATT error: ' + e.message)
      addOutput('  Hub rejected the start command.')
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}
