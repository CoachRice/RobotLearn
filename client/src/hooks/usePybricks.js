// client/src/hooks/usePybricks.js
// Protocol: https://docs.pybricks.com/projects/pybricksdev/en/latest/api/ble/pybricks.html
import { useState, useCallback, useRef } from 'react'

// ── UUIDs ────────────────────────────────────────────────────
const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

// ── Official command bytes (pybricksdev Command enum) ─────────
const CMD_STOP_USER_PROGRAM       = 0x00
const CMD_START_USER_PROGRAM      = 0x01
const CMD_WRITE_USER_PROGRAM_META = 0x03  // payload: program size (uint32 LE)
const CMD_WRITE_USER_RAM          = 0x04  // payload: offset (uint32 LE) + data

// ── Official event bytes (pybricksdev Event enum) ─────────────
const EVT_STATUS_REPORT = 0x00  // payload: StatusFlag (uint32 LE)
const EVT_WRITE_STDOUT  = 0x01  // payload: stdout bytes

// ── Hub capabilities format (pybricksdev unpack_hub_capabilities) ─
// <HII = uint16 + uint32 + uint32 = 10 bytes (protocol v1.2)
// or <HIIB = + uint8 = 11 bytes  (protocol v1.5)
// max_char_size is at byte 0 (uint16 LE) — the max BLE write size the hub accepts
const DEFAULT_MAX_CHAR_SIZE = 100  // safe fallback if capabilities can't be read

// ── Create a multi-file program blob ─────────────────────────
// The hub expects a wrapped blob format, not raw .mpy bytes.
// Format for each file entry:
//   [1 byte: filename length]
//   [N bytes: filename UTF-8 (no extension)]
//   [4 bytes: data length uint32 LE]
//   [M bytes: .mpy data]
// The main entry point must be named "__main__".
function createProgramBlob(mpy) {
  const name      = '__main__'
  const nameBytes = new TextEncoder().encode(name)
  const blob      = new Uint8Array(1 + nameBytes.length + 4 + mpy.length)
  let   off       = 0

  blob[off++] = nameBytes.length             // 1 byte: name length
  blob.set(nameBytes, off); off += nameBytes.length
  new DataView(blob.buffer).setUint32(off, mpy.length, true)  // 4 bytes LE: data size
  off += 4
  blob.set(mpy, off)
  return blob
}

// ── Compile Python → MPY ─────────────────────────────────────
async function compilePython(pythonCode) {
  const compilePromise = import('@pybricks/mpy-cross-v6').then(
    async ({ compile }) => {
      const raw = await compile('__main__.py', pythonCode, undefined, '/mpy-cross-v6.wasm')
      if (raw instanceof Uint8Array)          return raw
      if (raw?.mpy instanceof Uint8Array)     return raw.mpy
      if (raw?.output instanceof Uint8Array)  return raw.output
      throw new Error('Unexpected compile result: ' + JSON.stringify(Object.keys(raw || {})))
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

  const deviceRef      = useRef(null)
  const charRef        = useRef(null)
  const maxCharSizeRef = useRef(DEFAULT_MAX_CHAR_SIZE)

  const addOutput = useCallback((line) => {
    setOutput(prev => [...prev, line])
  }, [])

  const handleNotification = useCallback((event) => {
    const data = new Uint8Array(event.target.value.buffer)
    const type = data[0]

    if (type === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(data.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (type === EVT_STATUS_REPORT) {
      // Status flags: 32-bit LE integer at bytes 1-4
      const flags   = new DataView(data.buffer).getUint32(1, true)
      // Bit 0 of the second byte group indicates user program running.
      // StatusFlag.USER_PROGRAM_RUNNING = 0x0100 (bit 8 of the 32-bit flags).
      const running = (flags & 0x0100) !== 0
      setStatus(running ? 'running' : 'connected')
    }
  }, [addOutput])

  // ── connect ───────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setStatus('error')
      setErrorMsg('Web Bluetooth not supported — use Chrome or Edge on desktop.')
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

      // ── Read hub capabilities ──────────────────────────────
      // This gives us max_char_size: the maximum BLE write size the hub accepts.
      // Without this, we may send chunks that are too large and get silently dropped.
      try {
        const capChar  = await service.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capValue = await capChar.readValue()
        // Format: uint16 LE at offset 0 = max_char_size
        const maxSize  = new DataView(capValue.buffer).getUint16(0, true)
        maxCharSizeRef.current = maxSize
        addOutput(`✓ Hub max write size: ${maxSize} bytes`)
      } catch (e) {
        maxCharSizeRef.current = DEFAULT_MAX_CHAR_SIZE
        addOutput(`⚠ Could not read hub capabilities, using ${DEFAULT_MAX_CHAR_SIZE} bytes per chunk`)
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

    // Step 1: Compile Python → MPY
    setStatus('compiling'); addOutput('⚙ Compiling Python...')
    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ Compiled (${mpy.length} bytes)`)
    } catch (err) {
      setStatus('error'); setErrorMsg(err.message); addOutput('✗ ' + err.message); return
    }

    // Step 2: Wrap MPY in the multi-file blob format the hub expects
    const blob = createProgramBlob(mpy)
    addOutput(`✓ Program blob created (${blob.length} bytes)`)

    // Step 3: Upload blob
    setStatus('uploading'); addOutput('⬆ Uploading to hub...')
    const maxPayload = maxCharSizeRef.current - 5  // 5 = 1 cmd byte + 4 offset bytes

    try {
      // Stop any running program first
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_STOP_USER_PROGRAM]))
      await delay(400)

      // Write program size metadata (hub uses this to allocate RAM)
      const meta = new Uint8Array(5)
      meta[0] = CMD_WRITE_USER_PROGRAM_META
      new DataView(meta.buffer).setUint32(1, blob.length, true)
      await charRef.current.writeValueWithoutResponse(meta)
      await delay(200)

      // Write blob in chunks sized to hub's max_char_size
      let offset = 0
      while (offset < blob.length) {
        const chunkSize = Math.min(maxPayload, blob.length - offset)
        const chunk     = blob.slice(offset, offset + chunkSize)
        const packet    = new Uint8Array(5 + chunkSize)
        packet[0] = CMD_WRITE_USER_RAM
        new DataView(packet.buffer).setUint32(1, offset, true)
        packet.set(chunk, 5)
        await charRef.current.writeValueWithoutResponse(packet)
        offset += chunkSize
        await delay(80)
      }
      addOutput(`✓ Upload complete (${offset} bytes in ${Math.ceil(blob.length / maxPayload)} chunk${blob.length > maxPayload ? 's' : ''})`)
    } catch (err) {
      setStatus('error'); setErrorMsg('Upload failed: ' + err.message)
      addOutput('✗ Upload failed — try reconnecting.'); return
    }

    // Step 4: Start program
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
