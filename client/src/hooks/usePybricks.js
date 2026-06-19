// client/src/hooks/usePybricks.js
// Protocol: https://docs.pybricks.com/projects/pybricksdev/en/latest/api/ble/pybricks.html
// Key insight: use writeValueWithoutResponse for all commands (matches pybricksdev response=False)
// writeValue (with response) causes Chrome to timeout waiting for hub's GATT ack on slow ops.
import { useState, useCallback, useRef } from 'react'

const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

// Commands (pybricksdev Command enum, protocol v1.2+)
const CMD_STOP_USER_PROGRAM       = 0x00
const CMD_START_USER_PROGRAM      = 0x01
const CMD_WRITE_USER_PROGRAM_META = 0x03  // [size uint32 LE]
const CMD_WRITE_USER_RAM          = 0x04  // [offset uint32 LE][data...]

const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

// ── Multi-file blob format ────────────────────────────────────
// Derived from hub flash dump (pybricks discussion #1567):
//   offset  0: file_count (uint32 LE) = 1
//   offset  4: mpy_size   (uint32 LE) = byte length of the .mpy file
//   offset  8: '__main__\0' (null-terminated, 9 bytes)
//   offset 17: .mpy data (mpy_size bytes)
//
// Total = 4 + 4 + 9 + mpy.length = mpy.length + 17 bytes
function createBlob(mpy) {
  const name      = '__main__'
  const nameBytes = new TextEncoder().encode(name)     // 8 bytes
  const blob      = new Uint8Array(4 + 4 + nameBytes.length + 1 + mpy.length)
  const dv        = new DataView(blob.buffer)
  let   off       = 0

  dv.setUint32(off, 1, true);           off += 4  // file_count = 1
  dv.setUint32(off, mpy.length, true);  off += 4  // mpy_size
  blob.set(nameBytes, off);             off += nameBytes.length
  blob[off++] = 0                                  // null terminator for name
  blob.set(mpy, off)                               // .mpy bytes
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
    setTimeout(() => rej(new Error('Compilation timed out after 15 s')), 15000))
  return Promise.race([p, t])
}

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Fire-and-forget write (no GATT ack wait) ─────────────────
// Matches pybricksdev's response=False — avoids Chrome GATT timeout
// on slow operations like RAM allocation (META) or multi-chunk uploads.
async function wr(char, data) {
  await char.writeValueWithoutResponse(data)
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
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
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

      // Read hub capabilities
      try {
        const capChar = await service.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        const cv      = new DataView(capVal.buffer)
        maxCharRef.current = cv.getUint16(0, true)
        const flags   = capVal.byteLength >= 6 ? cv.getUint32(2, true) : 0
        const maxProg = capVal.byteLength >= 10 ? cv.getUint32(6, true) : 0
        addOutput(`✓ Max write: ${maxCharRef.current}B | Max prog: ${maxProg}B | Caps: 0x${flags.toString(16)}`)
      } catch (e) {
        addOutput(`⚠ Could not read capabilities: ${e.message}`)
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
      await wr(charRef.current, new Uint8Array([CMD_STOP_USER_PROGRAM]))
      setStatus('connected'); addOutput('⏹ Stopped.')
    } catch (e) { setStatus('error'); setErrorMsg('Stop failed: ' + e.message) }
  }, [addOutput])

  // ── run ───────────────────────────────────────────────────
  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)

    // Step 1 — Compile
    setStatus('compiling'); addOutput('⚙ Compiling...')
    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ mpy: ${mpy.length}B`)
    } catch (e) {
      setStatus('error'); setErrorMsg(e.message); addOutput('✗ ' + e.message); return
    }

    // Step 2 — Build blob
    // [file_count 4B][mpy_size 4B][__main__\0 9B][mpy data NB]
    const blob       = createBlob(mpy)
    const maxPayload = maxCharRef.current - 5  // 5B = cmd(1) + offset(4)
    addOutput(`✓ blob: ${blob.length}B (header:17 + mpy:${mpy.length}) | chunk payload: ${maxPayload}B`)

    // Step 3 — Upload via writeValueWithoutResponse (no GATT ack wait)
    setStatus('uploading'); addOutput('⬆ Uploading...')
    try {
      // STOP
      await wr(charRef.current, new Uint8Array([CMD_STOP_USER_PROGRAM]))
      await delay(600)

      // META — tell hub total blob size so it can allocate RAM
      const meta = new Uint8Array(5)
      meta[0] = CMD_WRITE_USER_PROGRAM_META
      new DataView(meta.buffer).setUint32(1, blob.length, true)
      await wr(charRef.current, meta)
      await delay(400)  // give hub time to allocate RAM

      // WRITE chunks
      let off = 0, n = 0
      while (off < blob.length) {
        const size   = Math.min(maxPayload, blob.length - off)
        const chunk  = blob.slice(off, off + size)
        const packet = new Uint8Array(5 + size)
        packet[0] = CMD_WRITE_USER_RAM
        new DataView(packet.buffer).setUint32(1, off, true)
        packet.set(chunk, 5)
        await wr(charRef.current, packet)
        off += size; n++
        await delay(100)
      }
      addOutput(`✓ Uploaded ${off}B in ${n} chunk${n > 1 ? 's' : ''}`)
      await delay(300)
    } catch (e) {
      setStatus('error'); setErrorMsg('Upload error: ' + e.message)
      addOutput('✗ Upload error: ' + e.message); return
    }

    // Step 4 — START
    setStatus('running'); addOutput('▶ Running...')
    addOutput('─────────────────')
    try {
      await wr(charRef.current, new Uint8Array([CMD_START_USER_PROGRAM]))
    } catch (e) {
      setStatus('error'); setErrorMsg('Start error: ' + e.message)
      addOutput('✗ Start error: ' + e.message)
    }
  }, [addOutput])

  return { connect, disconnect, run, stop, status, output, hubName, errorMsg }
}