// client/src/components/Tasks.jsx
// ─────────────────────────────────────────────────────────────
// Updated to include:
//   • Connect to hub button + status indicator
//   • Run / Stop buttons that compile and execute code on the hub
//   • Live output console showing print() results
//   • AI feedback submit button (unchanged)
// ─────────────────────────────────────────────────────────────
import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { usePybricks } from '../hooks/usePybricks'

const TASKS = [
  {
    slug:   'l1-build',
    title:  'Topic 1 — Build your robot',
    goal:   'Assemble the Spike Prime driving base using the official LEGO building instructions.',
    type:   'pdf',
    mode:   'blockly',
    pdfUrl: 'https://assets.education.lego.com/v3/assets/blt293eea581807678a/blte58422fa7d508a60/5f8802b882eaa522ca601c9f/driving-base-bi-pdf-book1of1.pdf?locale=en-us',
  },
  {
    slug:  'l1-hello',
    title: 'Topic 2 — Hello robot',
    type:  'code',
    mode:  'blockly',
    learn: {
      intro:
        'Every PyBricks program starts with imports — a shopping list of tools ' +
        'you need from the library. After importing, you create a hub object that ' +
        'represents your real Spike Prime hub. From that point on, typing ' +
        'hub.something controls real hardware.',
      concepts: [
        { code: 'from pybricks.hubs import PrimeHub',    desc: 'imports the hub class from the PyBricks library' },
        { code: 'from pybricks.parameters import Color', desc: 'imports colour constants: GREEN, RED, BLUE, YELLOW, etc.' },
        { code: 'from pybricks.tools import wait',       desc: 'imports the wait() pause function' },
        { code: 'hub = PrimeHub()',                      desc: 'creates the hub object — do this once at the top of every program' },
        { code: 'hub.light.on(Color.GREEN)',             desc: 'turns the status LED green' },
        { code: 'hub.light.off()',                       desc: 'turns the status LED off' },
        { code: 'wait(500)',                             desc: 'pauses the program for 500 milliseconds (0.5 seconds)' },
        { code: "print('Hello!')",                       desc: 'prints a message to the output console' },
      ],
      colorsNote:
        'Available colours: Color.RED · Color.GREEN · Color.BLUE · Color.YELLOW · ' +
        'Color.ORANGE · Color.WHITE · Color.CYAN · Color.MAGENTA',
    },
    example:
      'from pybricks.hubs import PrimeHub\n' +
      'from pybricks.parameters import Color\n' +
      'from pybricks.tools import wait\n' +
      '\n' +
      '# Create the hub object — always do this first\n' +
      'hub = PrimeHub()\n' +
      '\n' +
      '# Flash green for 1 second\n' +
      'hub.light.on(Color.GREEN)\n' +
      'wait(1000)          # 1000 ms = 1 second\n' +
      '\n' +
      '# Flash red for 1 second\n' +
      'hub.light.on(Color.RED)\n' +
      'wait(1000)\n' +
      '\n' +
      '# Turn the light off at the end\n' +
      "hub.light.off()\nprint('Done!')",
    goal:
      "Flash the hub light GREEN, then YELLOW, then BLUE — with 0.5 s between " +
      "each colour. Print 'Done!' at the end. The light must be off when the program finishes.",
    rubric: [
      { criterion: 'GREEN shown with wait(500) after it',   points: 25 },
      { criterion: 'YELLOW shown with wait(500) after it',  points: 25 },
      { criterion: 'BLUE shown with wait(500) after it',    points: 25 },
      { criterion: 'hub.light.off() called at the end',     points: 10 },
      { criterion: "print('Done!') present",                points: 10 },
      { criterion: 'At least one comment in the code',      points:  5 },
    ],
    starter:
      'from pybricks.hubs import PrimeHub\n' +
      'from pybricks.parameters import Color\n' +
      'from pybricks.tools import wait\n' +
      '\n' +
      'hub = PrimeHub()\n' +
      '\n' +
      '# Your code here:\n',
  },
  {
    slug:  'l1-drive',
    title: 'Topic 3 — Drive straight',
    type:  'code',
    mode:  'blockly',
    learn: null,
    example: null,
    goal:  'Drive exactly 500 mm forward and stop. Robot must stop within 3 cm of the mark.',
    rubric: [
      { criterion: 'DriveBase initialized with correct wheel_diameter and axle_track', points: 25 },
      { criterion: 'robot.straight(500) called correctly',                            points: 35 },
      { criterion: 'No extra movements or unnecessary delays',                         points: 20 },
      { criterion: 'At least one comment in the code',                                points: 20 },
    ],
    starter:
      'from pybricks.hubs import PrimeHub\n' +
      'from pybricks.pupdevices import Motor\n' +
      'from pybricks.robotics import DriveBase\n' +
      'from pybricks.parameters import Port, Direction\n' +
      '\n' +
      'hub   = PrimeHub()\n' +
      'left  = Motor(Port.A, Direction.COUNTERCLOCKWISE)\n' +
      'right = Motor(Port.B)\n' +
      'robot = DriveBase(left, right, wheel_diameter=56, axle_track=112)\n' +
      '\n' +
      '# Your code here:\n',
  },
  {
    slug:  'l1-turn',
    title: 'Topic 4 — Turn and navigate',
    type:  'code',
    mode:  'blockly',
    learn: null,
    example: null,
    goal:  'Drive 40 cm forward, turn 90° right, drive 20 cm. Print the final heading.',
    rubric: [
      { criterion: 'Correct three movements in order (straight → turn → straight)', points: 40 },
      { criterion: 'hub.imu.reset_heading(0) called at the start',                  points: 20 },
      { criterion: 'Final heading printed with hub.imu.heading()',                   points: 25 },
      { criterion: 'Comments present',                                               points: 15 },
    ],
    starter: '# Add your DriveBase setup, then your movements here.\n',
  },
]

// ── Status indicator pill ─────────────────────────────────────
function StatusPill({ status }) {
  const styles = {
    disconnected: 'bg-gray-100 text-gray-500',
    connecting:   'bg-amber-100 text-amber-700',
    connected:    'bg-green-100 text-green-700',
    compiling:    'bg-blue-100 text-blue-700',
    uploading:    'bg-blue-100 text-blue-700',
    running:      'bg-purple-100 text-purple-700',
    error:        'bg-red-100 text-red-700',
  }
  const labels = {
    disconnected: '⚫ Not connected',
    connecting:   '🔵 Connecting...',
    connected:    '🟢 Hub connected',
    compiling:    '⚙️ Compiling...',
    uploading:    '⬆️ Uploading...',
    running:      '▶️ Running',
    error:        '🔴 Error',
  }
  return (
    <span className={`text-xs font-medium px-3 py-1 rounded-full ${styles[status] || styles.disconnected}`}>
      {labels[status] || status}
    </span>
  )
}

// ── Main Tasks component ──────────────────────────────────────
export default function Tasks({ student }) {
  const [active,    setActive]   = useState(0)
  const [tab,       setTab]      = useState('learn')
  const [code,      setCode]     = useState(TASKS[1].starter)
  const [feedback,  setFeedback] = useState(null)
  const [loading,   setLoading]  = useState(false)
  const [error,     setError]    = useState(null)
  const [buildDone, setBuildDone] = useState(false)

  // PyBricks BLE hook — shared across all topics
  const pybricks = usePybricks()

  function selectTask(i) {
    setActive(i)
    setTab(TASKS[i].type === 'pdf' ? 'pdf' : 'learn')
    setCode(TASKS[i].starter || '')
    setFeedback(null)
    setError(null)
  }

  // ── Submit code to AI for feedback ───────────────────────────
  async function submit() {
    setLoading(true); setError(null); setFeedback(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentCode: code,
          taskSlug:    TASKS[active].slug,
          studentId:   student?.id,
        }),
      })
      setFeedback(await res.json())
    } catch {
      setError('Could not connect to the server. Is it running?')
    } finally {
      setLoading(false)
    }
  }

  // ── Mark PDF topic as read ────────────────────────────────────
  async function markBuildComplete() {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentCode: 'CHECKLIST_COMPLETE',
        taskSlug:    'l1-build',
        studentId:   student?.id,
      }),
    })
    setBuildDone(true)
    setTimeout(() => selectTask(1), 800)
  }

  const task       = TASKS[active]
  const score      = feedback?.score ?? 0
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-500' : 'text-red-500'
  const isRunning  = pybricks.status === 'running'
  const canRun     = ['connected', 'running', 'compiling', 'uploading'].includes(pybricks.status)
                     && !isRunning

  return (
    <div>
      <div className='flex items-center justify-between mb-5'>
        <h1 className='text-2xl font-semibold text-gray-800'>Learning path</h1>

        {/* Hub connection bar — always visible */}
        <div className='flex items-center gap-3'>
          <StatusPill status={pybricks.status} />
          {pybricks.status === 'disconnected' || pybricks.status === 'error' ? (
            <button
              onClick={pybricks.connect}
              className='text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg
                         hover:bg-blue-700 font-medium'>
              Connect hub
            </button>
          ) : (
            <button
              onClick={pybricks.disconnect}
              className='text-sm border border-gray-200 text-gray-500 px-4 py-1.5
                         rounded-lg hover:bg-gray-50'>
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Error from BLE */}
      {pybricks.errorMsg && (
        <div className='bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700'>
          {pybricks.errorMsg}
        </div>
      )}

      {/* Topic tabs */}
      <div className='flex gap-2 flex-wrap mb-5'>
        {TASKS.map((t, i) => (
          <button key={i} onClick={() => selectTask(i)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              active === i
                ? 'bg-green-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.title.split('—')[0].trim()}
          </button>
        ))}
      </div>

      {/* ── PDF topic (Build your robot) ─────────────────────── */}
      {task.type === 'pdf' && (
        <div>
          <p className='text-sm text-gray-600 mb-3'>
            Follow the official LEGO building instructions below to assemble
            your Spike Prime driving base. Click <strong>Mark as read</strong> when done.
          </p>
          <iframe
            src={task.pdfUrl}
            className='w-full border border-gray-200 rounded-lg'
            height='480'
            title='Spike Prime Driving Base Building Instructions'
          />
          <p className='text-xs text-gray-400 mt-2'>
            Can't see the PDF?{' '}
            <a href={task.pdfUrl} target='_blank' rel='noopener'
               className='text-blue-500 hover:underline'>
              Open in new tab ↗
            </a>
          </p>
          <button onClick={markBuildComplete} disabled={buildDone}
            className='mt-4 bg-green-600 text-white px-5 py-2 rounded-lg
                       text-sm font-medium hover:bg-green-700 disabled:opacity-60'>
            {buildDone ? 'Done! Opening Topic 2…' : 'Mark as read — unlock Hello Robot →'}
          </button>
        </div>
      )}

      {/* ── Code topic ───────────────────────────────────────── */}
      {task.type === 'code' && (
        <div>

          {/* Tab bar */}
          {task.learn && (
            <div className='flex border-b border-gray-200 mb-4'>
              {['learn', 'code', 'task'].map((t, i) => {
                const labels = ['Learn', 'Code example', 'Task']
                if (t === 'code' && !task.example) return null
                return (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                      tab === t
                        ? 'border-green-600 text-green-700 font-medium'
                        : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                    {labels[i]}
                  </button>
                )
              })}
            </div>
          )}

          {/* LEARN TAB */}
          {tab === 'learn' && task.learn && (
            <div className='space-y-4'>
              <p className='text-sm text-gray-700 leading-relaxed'>{task.learn.intro}</p>
              <div>
                <p className='text-xs font-medium text-gray-400 uppercase tracking-wide mb-2'>
                  Key concepts
                </p>
                <div className='space-y-2'>
                  {task.learn.concepts.map((c, i) => (
                    <div key={i} className='flex items-start gap-3 bg-white border
                                           border-gray-200 rounded-lg px-3 py-2'>
                      <code className='text-blue-700 text-xs bg-blue-50 px-1.5 py-0.5
                                       rounded font-mono flex-shrink-0'>
                        {c.code}
                      </code>
                      <span className='text-sm text-gray-500'>— {c.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
              {task.learn.colorsNote && (
                <p className='text-xs text-gray-400'>{task.learn.colorsNote}</p>
              )}
              <button onClick={() => setTab(task.example ? 'code' : 'task')}
                className='text-sm text-green-600 font-medium hover:underline'>
                {task.example ? 'See the code example →' : 'Go to the task →'}
              </button>
            </div>
          )}

          {/* CODE EXAMPLE TAB */}
          {tab === 'code' && task.example && (
            <div>
              <p className='text-sm text-gray-500 mb-3'>
                Study this example — it is for reference only, you do not submit this.
              </p>
              <div className='rounded-xl overflow-hidden border border-gray-200 mb-3'>
                <Editor
                  height='220px' language='python' value={task.example}
                  theme='vs-dark'
                  options={{ fontSize:13, readOnly:true, minimap:{ enabled:false } }}
                />
              </div>
              <button onClick={() => setTab('task')}
                className='text-sm text-green-600 font-medium hover:underline'>
                Ready? Go to the task →
              </button>
            </div>
          )}

          {/* TASK TAB */}
          {(tab === 'task' || !task.learn) && (
            <div>

              {/* Blockly workflow note */}
              {task.mode === 'blockly' && (
                <div className='bg-amber-50 border border-amber-200 rounded-xl p-4 mb-3'>
                  <p className='text-sm font-semibold text-amber-800 mb-2'>
                    🧩 Blockly mode — how to submit
                  </p>
                  <ol className='space-y-1'>
                    {[
                      <span key='s1'>Build your program at{' '}
                        <a href='https://code.pybricks.com' target='_blank'
                           rel='noopener' className='text-blue-600 hover:underline font-medium'>
                          code.pybricks.com
                        </a>{' '}using Blockly blocks</span>,
                      'Click the Python tab in PyBricks to see the generated code',
                      'Press Ctrl+A then Ctrl+C to copy all the Python',
                      'Paste it into the editor below (Ctrl+V)',
                      'Click Run to test on the robot, then Submit for AI feedback',
                    ].map((step, i) => (
                      <li key={i} className='flex gap-2 text-sm text-amber-700'>
                        <span className='font-medium text-amber-900 flex-shrink-0'>{i+1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <p className='text-xs text-amber-600 mt-2 italic'>
                    The AI reviews the generated Python the same as hand-written code.
                  </p>
                </div>
              )}

              {/* Task goal */}
              <div className='bg-blue-50 border border-blue-200 rounded-xl p-4 mb-3'>
                <h2 className='font-semibold text-blue-800 text-sm'>{task.title}</h2>
                <p className='text-sm text-blue-700 mt-1'>{task.goal}</p>
              </div>

              {/* Rubric */}
              {task.rubric && (
                <div className='mb-3'>
                  <p className='text-xs font-medium text-gray-400 uppercase tracking-wide mb-2'>
                    Rubric
                  </p>
                  <div className='bg-white border border-gray-200 rounded-lg overflow-hidden'>
                    {task.rubric.map((r, i) => (
                      <div key={i}
                        className={`flex justify-between items-center px-3 py-2 text-sm ${
                          i < task.rubric.length - 1 ? 'border-b border-gray-100' : ''}`}>
                        <span className='text-gray-600'>{r.criterion}</span>
                        <span className='font-medium text-purple-700 flex-shrink-0 ml-3'>
                          {r.points} pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Code editor */}
              <div className='rounded-xl overflow-hidden border border-gray-200 mb-3'>
                <Editor
                  height='220px' language='python'
                  value={code} onChange={v => setCode(v)}
                  theme='vs-dark'
                  options={{ fontSize:13, minimap:{ enabled:false } }}
                />
              </div>

              {/* Run / Stop / Submit buttons */}
              <div className='flex gap-2 flex-wrap items-center'>
                {/* Run button */}
                <button
                  onClick={() => pybricks.run(code)}
                  disabled={!['connected'].includes(pybricks.status)}
                  title={pybricks.status === 'disconnected'
                    ? 'Connect a hub first to run code'
                    : 'Run this code on the connected hub'}
                  className='bg-blue-600 text-white px-5 py-2 rounded-lg text-sm
                             font-medium hover:bg-blue-700 disabled:opacity-40 flex items-center gap-2'>
                  ▶ Run on hub
                </button>

                {/* Stop button — only shown while running/uploading */}
                {['running', 'uploading', 'compiling'].includes(pybricks.status) && (
                  <button
                    onClick={pybricks.stop}
                    className='bg-red-600 text-white px-5 py-2 rounded-lg text-sm
                               font-medium hover:bg-red-700 flex items-center gap-2'>
                    ⏹ Stop
                  </button>
                )}

                {/* Submit for AI feedback */}
                <button onClick={submit} disabled={loading}
                  className='bg-green-600 text-white px-5 py-2 rounded-lg text-sm
                             font-medium hover:bg-green-700 disabled:opacity-50'>
                  {loading ? 'Analysing…' : 'Submit for AI feedback'}
                </button>
              </div>

              {/* Output console */}
              {pybricks.output.length > 0 && (
                <div className='mt-4'>
                  <p className='text-xs font-medium text-gray-400 uppercase tracking-wide mb-1'>
                    Hub output
                  </p>
                  <div className='bg-gray-900 rounded-lg p-3 font-mono text-xs
                                  text-green-400 min-h-12 max-h-40 overflow-y-auto'>
                    {pybricks.output.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className='mt-3 text-sm text-red-600'>{error}</p>}

              {/* AI Feedback panel */}
              {feedback && (
                <div className='mt-5 bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
                  <div className='flex items-baseline gap-2 flex-wrap'>
                    <span className={`text-5xl font-bold ${scoreColor}`}>{feedback.score}</span>
                    <span className='text-gray-400'>/ 100</span>
                    {feedback.unlockedSlug && (
                      <span className='ml-2 text-xs bg-green-50 text-green-700 border
                                       border-green-200 rounded-full px-3 py-1'>
                        Next topic unlocked!
                      </span>
                    )}
                  </div>
                  <p className='text-sm text-gray-600'>{feedback.summary}</p>
                  {feedback.strengths?.length > 0 && (
                    <div>
                      <p className='text-sm font-semibold text-green-700 mb-1'>What you did well</p>
                      {feedback.strengths.map((s, i) => (
                        <p key={i} className='text-sm text-gray-600 flex gap-2'>
                          <span className='text-green-500'>✓</span>{s}
                        </p>
                      ))}
                    </div>
                  )}
                  {feedback.issues?.length > 0 && (
                    <div>
                      <p className='text-sm font-semibold text-amber-700 mb-1'>Things to improve</p>
                      {feedback.issues.map((issue, i) => (
                        <div key={i} className='bg-amber-50 border border-amber-200 rounded-lg p-3 mb-2'>
                          <p className='text-xs font-medium text-amber-800'>
                            Line {issue.lineNumber}: {issue.problem}
                          </p>
                          <p className='text-xs text-amber-700 mt-1'>{issue.suggestion}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {feedback.nextSteps?.length > 0 && (
                    <div>
                      <p className='text-sm font-semibold text-blue-700 mb-1'>Next steps</p>
                      {feedback.nextSteps.map((s, i) => (
                        <p key={i} className='text-sm text-gray-600 flex gap-2'>
                          <span className='text-blue-500'>{i+1}.</span>{s}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
