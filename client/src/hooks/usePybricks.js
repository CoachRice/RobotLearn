// client/src/hooks/usePybricks.js
// Protocol: https://docs.pybricks.com/projects/pybricksdev/en/latest/api/ble/pybricks.html
// Blob format reverse-engineered from hub flash dump discussion:
// https://github.com/orgs/pybricks/discussions/1567
// Observed bytes at PROGRAM_START+4: 30 00 00 00  5f 5f 6d 61 69 6e 5f 5f 00  4d 06 ...
//   = [mpy_size uint32 LE] [__main__\0]  [mpy bytes starting with M\x06]
// Bytes at PROGRAM_START (not shown, first 4 bytes): assumed = file_count uint32 LE
import { useState, useCallback, useRef } from 'react'

// ── UUIDs ────────────────────────────────────────────────────
const PYBRICKS_SERVICE_UUID      = 'c5f50001-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CHAR_UUID         = 'c5f50002-8280-46da-89f4-6d8051e4aeef'
const PYBRICKS_CAPABILITIES_UUID = 'c5f50003-8280-46da-89f4-6d8051e4aeef'

// ── Official command bytes ────────────────────────────────────
const CMD_STOP_USER_PROGRAM       = 0x00
const CMD_START_USER_PROGRAM      = 0x01
const CMD_WRITE_USER_PROGRAM_META = 0x03  // payload: total program size (uint32 LE)
const CMD_WRITE_USER_RAM          = 0x04  // payload: offset (uint32 LE) + data

// ── Official event bytes ──────────────────────────────────────
const EVT_STATUS_REPORT = 0x00
const EVT_WRITE_STDOUT  = 0x01

const DEFAULT_MAX_CHAR = 100

// ── Build the multi-file program blob ─────────────────────────
// Format derived from hub.system.storage() flash dump (discussion #1567):
//   PROGRAM_START + 0:  file_count (uint32 LE)         — e.g. 1
//   PROGRAM_START + 4:  mpy_size   (uint32 LE)         — byte length of the .mpy
//   PROGRAM_START + 8:  '__main__\0' (null-terminated) — entry point name
//   PROGRAM_START + 17: mpy data (mpy_size bytes)
//
// For a single-file program this totals: 4 + 4 + 9 + mpy.length bytes
function createProgramBlob(mpy) {
  const name      = '__main__'
  const nameBytes = new TextEncoder().encode(name)  // 8 bytes
  // Layout: [file_count 4B] [mpy_size 4B] [name N bytes] [null 1B] [mpy data]
  const blob = new Uint8Array(4 + 4 + nameBytes.length + 1 + mpy.length)
  const view = new DataView(blob.buffer)
  let off = 0

  view.setUint32(off, 1, true)           // file_count = 1
  off += 4
  view.setUint32(off, mpy.length, true)  // mpy_size
  off += 4
  blob.set(nameBytes, off)               // '__main__'
  off += nameBytes.length
  blob[off++] = 0                        // null terminator
  blob.set(mpy, off)                     // .mpy bytes
  return blob
}

// ── Compile Python → MPY ─────────────────────────────────────
async function compilePython(pythonCode) {
  const compilePromise = import('@pybricks/mpy-cross-v6').then(
    async ({ compile }) => {
      const raw = await compile('__main__.py', pythonCode, undefined, '/mpy-cross-v6.wasm')
      if (raw instanceof Uint8Array)         return raw
      if (raw?.mpy instanceof Uint8Array)    return raw.mpy
      if (raw?.output instanceof Uint8Array) return raw.output
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
  const maxCharRef     = useRef(DEFAULT_MAX_CHAR)

  const addOutput = useCallback((line) => {
    setOutput(prev => [...prev, line])
  }, [])

  const handleNotification = useCallback((event) => {
    const data = new Uint8Array(event.target.value.buffer)
    if (data[0] === EVT_WRITE_STDOUT) {
      const text = new TextDecoder().decode(data.slice(1))
      text.split('\n').filter(l => l.length > 0).forEach(l => addOutput(l))
    }
    if (data[0] === EVT_STATUS_REPORT) {
      const flags   = new DataView(data.buffer).getUint32(1, true)
      const running = (flags & 0x0100) !== 0  // bit 8 = USER_PROGRAM_RUNNING
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

      // Read hub capabilities to get max BLE write size
      try {
        const capChar = await service.getCharacteristic(PYBRICKS_CAPABILITIES_UUID)
        const capVal  = await capChar.readValue()
        maxCharRef.current = new DataView(capVal.buffer).getUint16(0, true)
        addOutput(`✓ Hub max write: ${maxCharRef.current} bytes`)
      } catch {
        maxCharRef.current = DEFAULT_MAX_CHAR
        addOutput(`⚠ Using default ${DEFAULT_MAX_CHAR} bytes per chunk`)
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
    } catch (err) { setStatus('error'); setErrorMsg('Stop failed: ' + err.message) }
  }, [addOutput])

  // ── run ───────────────────────────────────────────────────
  const run = useCallback(async (pythonCode) => {
    if (!charRef.current) {
      setStatus('error'); setErrorMsg('Not connected.'); return
    }
    setOutput([]); setErrorMsg(null)

    // Show the hub's max write size (cleared by setOutput above, re-show here)
    const maxPayload = maxCharRef.current - 5
    addOutput(`ℹ Max write: ${maxCharRef.current}B, payload: ${maxPayload}B`)

    // Step 1: Compile
    setStatus('compiling'); addOutput('⚙ Compiling...')
    let mpy
    try {
      mpy = await compilePython(pythonCode)
      addOutput(`✓ Compiled (${mpy.length} bytes)`)
    } catch (err) {
      setStatus('error'); setErrorMsg(err.message); addOutput('✗ ' + err.message); return
    }

    // Step 2: Create blob with correct format
    // Format: [file_count uint32 LE][mpy_size uint32 LE][__main__\0][mpy data]
    const blob = createProgramBlob(mpy)
    addOutput(`✓ Blob: ${blob.length}B (4+4+9+${mpy.length})`)

    // Step 3: Upload
    setStatus('uploading'); addOutput('⬆ Uploading...')
    try {
      // Stop any running program
      await charRef.current.writeValueWithoutResponse(new Uint8Array([CMD_STOP_USER_PROGRAM]))
      await delay(400)

      // Tell hub total blob size
      const meta = new Uint8Array(5)
      meta[0] = CMD_WRITE_USER_PROGRAM_META
      new DataView(meta.buffer).setUint32(1, blob.length, true)
      await charRef.current.writeValueWithoutResponse(meta)
      addOutput(`  META: size=${blob.length}`)
      await delay(200)

      // Write blob in chunks
      let offset   = 0
      let chunks   = 0
      while (offset < blob.length) {
        const size   = Math.min(maxPayload, blob.length - offset)
        const chunk  = blob.slice(offset, offset + size)
        const packet = new Uint8Array(5 + size)
        packet[0] = CMD_WRITE_USER_RAM
        new DataView(packet.buffer).setUint32(1, offset, true)
        packet.set(chunk, 5)
        await charRef.current.writeValueWithoutResponse(packet)
        offset += size
        chunks++
        await delay(80)
      }
      addOutput(`✓ Uploaded ${offset}B in ${chunks} chunk${chunks > 1 ? 's' : ''}`)
    } catch (err) {
      setStatus('error'); setErrorMsg('Upload failed: ' + err.message)
      addOutput('✗ Upload failed — reconnect and try again.'); return
    }

    // Step 4: Start
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
