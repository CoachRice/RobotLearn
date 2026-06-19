// client/src/hooks/usePybricks.js
// Blob format confirmed from hub flash dump (pybricks discussion #1567):
//   hub.system.storage(PROGRAM_START + 4, read=61) returned:
//   b'0\x00\x00\x00__main__\x00M\x06...'
//   Byte 0 of blob: mpy_size uint32 LE  (0x30 = 48 for that Hello World)
//   Byte 4+: __main__\0 (null-terminated name)
//   Byte 13+: mpy bytes starting with M\x06 magic
//   The 4 bytes at PROGRAM_START+0 (not shown) are filled by the hub after upload.
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

// ── Blob format: [mpy_size uint32 LE][name\0][mpy bytes] ──────
// Total = 4 + len(name) + 1 + mpy.length = mpy.length + 13 bytes
function createBlob(mpy) {
  const nameBytes = new TextEncoder().encode('__main__')  // 8 bytes
  const blob      = new Uint8Array(4 + nameBytes.length + 1 + mpy.length)
  const dv        = new DataView(blob.buffer)
  let   off       = 0

  dv.setUint32(off, mpy.length, true)   // mpy_size uint32 LE
  off += 4
  blob.set(nameBytes, off)              // '__main__'
  off += nameBytes.length
  blob[off++] = 0                       // null terminator
  blob.set(mpy, off)                    // .mpy bytecode
  return blob
}

async function compilePython(code) {
  const p = import('@pybricks/mpy-cross-v6').then(async ({ compile }) => {
    const r = await compile('__main__.py', code, undefined, '/mpy-cross-v6.wasm')
    if (r instanceof Uint8Array)         return r
    if (r?.mpy instanceof Uint8Array)    return r.mpy
    if (r?.output instanceof Uint8Array) return r.output
    throw new Error('Unexpected compile result: ' + JSON.stringify(Object.keys(r || {})))
  })
  const t = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('Compilation timed out')), 15000))
  return Promise.race([p, t])
}

const delay = ms => new Promise(r => setTimeout(r, ms))

export function usePybricks() {
  const [status,   setStatus]   = useState('disconnected')
  const [output,   setOutput]   = useState([])
  const [hubName,  setHubName]  = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const charRef   = useRef(null)
  const deviceRef = useRef(null)
  const maxCharRef = useRef(512)

  const addOutput = useCallback(l => setOutput(prev => [...prev, l]), [])

  const handleNotification = useCallback((event) => {
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
        addOutput(`✓ max_write:${maxCharRef.current}B | max_prog:${maxProg}B | caps:0x${flags.toString(16)}`)
      } catch (e) {
        addOutput(`⚠ caps unreadable: ${e.message}`)
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
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_STOP_USER_PROGRAM]))
      setStatus('connected'); addOutput('⏹ Stopped.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop: ' + e.message) }
  }, [addOutput])

  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)

    // Compile
    setStatus('compiling'); addOutput('⚙ Compiling...')
    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ mpy: ${mpy.length}B  first bytes: ${Array.from(mpy.slice(0,4)).map(b=>'0x'+b.toString(16)).join(' ')}`)
    } catch (e) {
      setStatus('error'); setErrorMsg(e.message); addOutput('✗ ' + e.message); return
    }

    // Build blob: [mpy_size uint32 LE][__main__\0][mpy bytes]
    const blob       = createBlob(mpy)
    const maxPayload = maxCharRef.current - 5
    addOutput(`✓ blob: ${blob.length}B  first 8 bytes: ${Array.from(blob.slice(0,8)).map(b=>'0x'+b.toString(16)).join(' ')}`)

    // Upload via writeValueWithoutResponse (matches pybricksdev response=False)
    setStatus('uploading'); addOutput('⬆ Uploading...')
    try {
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_STOP_USER_PROGRAM]))
      await delay(600)

      const meta = new Uint8Array(5)
      meta[0] = CMD_WRITE_USER_PROGRAM_META
      new DataView(meta.buffer).setUint32(1, blob.length, true)
      await charRef.current.writeValueWithoutResponse(meta)
      addOutput(`  META: size=${blob.length}`)
      await delay(400)

      let off = 0, n = 0
      while (off < blob.length) {
        const size   = Math.min(maxPayload, blob.length - off)
        const chunk  = blob.slice(off, off + size)
        const packet = new Uint8Array(5 + size)
        packet[0] = CMD_WRITE_USER_RAM
        new DataView(packet.buffer).setUint32(1, off, true)
        packet.set(chunk, 5)
        await charRef.current.writeValueWithoutResponse(packet)
        off += size; n++
        await delay(100)
      }
      addOutput(`✓ Uploaded ${off}B in ${n} chunk${n > 1 ? 's' : ''}`)
      await delay(300)
    } catch (e) {
      setStatus('error'); setErrorMsg('Upload: ' + e.message)
      addOutput('✗ Upload error: ' + e.message); return
    }

    // Start
    setStatus('running'); addOutput('▶ Running...')
    addOutput('─────────────────')
    try {
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_START_USER_PROGRAM]))
    } catch (e) {
      setStatus('error'); setErrorMsg('Start: ' + e.message)
      addOutput('✗ Start error: ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}