// client/src/components/Tasks.jsx
// ─────────────────────────────────────────────────────────────
// This file holds ALL lesson content for Level 1 topics.
// Each topic has:
//   type: 'pdf'  → shows the LEGO PDF + "Mark as read" button
//   type: 'code' → shows 3 tabs: Learn / Code example / Task
//   mode: 'blockly' → Level 1: student builds in PyBricks Blockly, pastes generated Python
//   mode: 'python'  → Level 2: student types Python directly in the editor
//
// Content for "Hello robot" is taken directly from the
// "Level 1 — Topic 2" section of robotlearn_complete_guide_v3.docx
// ─────────────────────────────────────────────────────────────
import { useState } from 'react'
import Editor from '@monaco-editor/react'

const TASKS = [

  // ── Topic 1: Build your robot ────────────────────────────
  // Content = official LEGO PDF. No learn/code tabs needed.
  {
    slug:   'l1-build',
    title:  'Topic 1 — Build your robot',
    goal:   'Assemble the Spike Prime driving base using the official LEGO building instructions.',
    type:   'pdf',
    pdfUrl: 'https://assets.education.lego.com/v3/assets/blt293eea581807678a/blte58422fa7d508a60/5f8802b882eaa522ca601c9f/driving-base-bi-pdf-book1of1.pdf?locale=en-us',
  },

  // ── Topic 2: Hello robot ─────────────────────────────────
  // Full content from robotlearn_complete_guide_v3.docx
  {
    slug:  'l1-hello',
    title: 'Topic 2 — Hello robot',
    type:  'code',
    mode:  'blockly',

    // ── Learn tab content ──────────────────────────────────
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
        { code: "print('Hello!')",                       desc: 'prints a message to the PyBricks console' },
      ],
      colorsNote:
        'Available colours: Color.RED · Color.GREEN · Color.BLUE · Color.YELLOW · ' +
        'Color.ORANGE · Color.WHITE · Color.CYAN · Color.MAGENTA',
    },

    // ── Code example tab content ───────────────────────────
    // Students read this before attempting the task.
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

    // ── Task tab content ───────────────────────────────────
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

    // Pre-filled starter code shown in the editor
    starter:
      'from pybricks.hubs import PrimeHub\n' +
      'from pybricks.parameters import Color\n' +
      'from pybricks.tools import wait\n' +
      '\n' +
      'hub = PrimeHub()\n' +
      '\n' +
      '# Your code here:\n',
  },

  // ── Topic 3: Drive straight ──────────────────────────────
  // (content to be added — starter code only for now)
  {
    slug:  'l1-drive',
    title: 'Topic 3 — Drive straight',
    type:  'code',
    mode:  'blockly',
    goal:  'Drive exactly 500 mm forward and stop. Robot must stop within 3 cm of the mark.',
    learn: null,   // fill in when ready
    example: null, // fill in when ready
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

  // ── Topic 4: Turn and navigate ───────────────────────────
  {
    slug:  'l1-turn',
    title: 'Topic 4 — Turn and navigate',
    type:  'code',
    mode:  'blockly',
    goal:  'Drive 40 cm forward, turn 90° right, drive 20 cm. Print the final heading.',
    learn: null,
    example: null,
    rubric: [
      { criterion: 'Correct three movements in order (straight → turn → straight)', points: 40 },
      { criterion: 'hub.imu.reset_heading(0) called at the start',                  points: 20 },
      { criterion: 'Final heading printed with hub.imu.heading()',                   points: 25 },
      { criterion: 'Comments present',                                               points: 15 },
    ],
    starter:
      '# Add your DriveBase setup, then your movements here.\n',
  },
]

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function Tasks({ student }) {
  const [active,    setActive]   = useState(0)
  const [tab,       setTab]      = useState('learn')  // 'learn' | 'code' | 'task'
  const [code,      setCode]     = useState(TASKS[1].starter)
  const [feedback,  setFeedback] = useState(null)
  const [loading,   setLoading]  = useState(false)
  const [error,     setError]    = useState(null)
  const [buildDone, setBuildDone] = useState(false)

  function selectTask(i) {
    setActive(i)
    setTab(TASKS[i].type === 'pdf' ? 'pdf' : 'learn')
    setCode(TASKS[i].starter || '')
    setFeedback(null)
    setError(null)
  }

  // ── Submit code for AI feedback ──────────────────────────
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

  // ── Mark PDF topic as read → unlock next topic ───────────
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
    setTimeout(() => selectTask(1), 800) // move to Hello robot
  }

  const task       = TASKS[active]
  const score      = feedback?.score ?? 0
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-500' : 'text-red-500'

  return (
    <div>
      <h1 className='text-2xl font-semibold text-gray-800 mb-5'>Learning path</h1>

      {/* Topic selector tabs */}
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

      {/* ── PDF topic (Build your robot) ─────────────────── */}
      {task.type === 'pdf' && (
        <div>
          <p className='text-sm text-gray-600 mb-3'>
            Follow the official LEGO building instructions below to assemble your
            Spike Prime driving base. When you have finished building, click the
            button at the bottom.
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
            className='mt-4 bg-green-600 text-white px-5 py-2 rounded-lg text-sm
                       font-medium hover:bg-green-700 disabled:opacity-60'>
            {buildDone ? 'Done! Opening Topic 2…' : 'Mark as read — unlock Hello Robot →'}
          </button>
        </div>
      )}

      {/* ── Code topic (Hello robot + others) ────────────── */}
      {task.type === 'code' && (
        <div>

          {/* 3-tab bar — only shown when learn content exists */}
          {task.learn && (
            <div className='flex border-b border-gray-200 mb-4'>
              {['learn', 'code', 'task'].map((t, i) => {
                const labels = ['Learn', 'Code example', 'Task']
                const hidden = t === 'code' && !task.example
                if (hidden) return null
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

          {/* ── LEARN TAB ──────────────────────────────────── */}
          {tab === 'learn' && task.learn && (
            <div className='space-y-4'>
              <p className='text-sm text-gray-700 leading-relaxed'>
                {task.learn.intro}
              </p>

              <div>
                <p className='text-xs font-medium text-gray-400 uppercase tracking-wide mb-2'>
                  Key concepts
                </p>
                <div className='space-y-2'>
                  {task.learn.concepts.map((c, i) => (
                    <div key={i}
                      className='flex items-start gap-3 bg-white border border-gray-200
                                 rounded-lg px-3 py-2'>
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
                <p className='text-xs text-gray-400 leading-relaxed'>
                  {task.learn.colorsNote}
                </p>
              )}

              <button onClick={() => setTab(task.example ? 'code' : 'task')}
                className='text-sm text-green-600 font-medium hover:underline'>
                {task.example ? 'See the code example →' : 'Go to the task →'}
              </button>
            </div>
          )}

          {/* ── CODE EXAMPLE TAB ───────────────────────────── */}
          {tab === 'code' && task.example && (
            <div>
              <p className='text-sm text-gray-500 mb-3'>
                Study this example before writing your own code. You do not need
                to submit this — it is for reference only.
              </p>
              <div className='rounded-xl overflow-hidden border border-gray-200 mb-3'>
                <Editor
                  height='220px'
                  language='python'
                  value={task.example}
                  theme='vs-dark'
                  options={{ fontSize: 13, readOnly: true, minimap: { enabled: false } }}
                />
              </div>
              <button onClick={() => setTab('task')}
                className='text-sm text-green-600 font-medium hover:underline'>
                Ready to try it yourself? Go to the task →
              </button>
            </div>
          )}

          {/* ── TASK TAB ───────────────────────────────────── */}
          {tab === 'task' && (
            <div>
              {/* Blockly submission steps (Level 1 only) */}
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
                      'Test it on your robot until it works correctly',
                      'Click the Python tab in the PyBricks editor',
                      'Press Ctrl+A then Ctrl+C to copy all the generated Python',
                      'Paste into the editor below (Ctrl+V) and click Submit',
                    ].map((step, i) => (
                      <li key={i} className='flex gap-2 text-sm text-amber-700'>
                        <span className='font-medium text-amber-900 flex-shrink-0'>{i + 1}.</span>
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

              {/* Rubric (if present) */}
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
                  height='220px'
                  language='python'
                  value={code}
                  onChange={v => setCode(v)}
                  theme='vs-dark'
                  options={{ fontSize: 13, minimap: { enabled: false } }}
                />
              </div>

              {/* Submit button */}
              <button onClick={submit} disabled={loading}
                className='bg-green-600 text-white px-6 py-2 rounded-lg text-sm
                           font-medium hover:bg-green-700 disabled:opacity-50'>
                {loading ? 'Analysing your code…' : 'Submit for AI feedback'}
              </button>

              {error && <p className='mt-3 text-sm text-red-600'>{error}</p>}

              {/* Feedback panel */}
              {feedback && (
                <div className='mt-5 bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
                  <div className='flex items-baseline gap-2 flex-wrap'>
                    <span className={`text-5xl font-bold ${scoreColor}`}>
                      {feedback.score}
                    </span>
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
                      <p className='text-sm font-semibold text-green-700 mb-1'>
                        What you did well
                      </p>
                      {feedback.strengths.map((s, i) => (
                        <p key={i} className='text-sm text-gray-600 flex gap-2'>
                          <span className='text-green-500'>✓</span>{s}
                        </p>
                      ))}
                    </div>
                  )}

                  {feedback.issues?.length > 0 && (
                    <div>
                      <p className='text-sm font-semibold text-amber-700 mb-1'>
                        Things to improve
                      </p>
                      {feedback.issues.map((issue, i) => (
                        <div key={i} className='bg-amber-50 border border-amber-200
                                                 rounded-lg p-3 mb-2'>
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
                          <span className='text-blue-500'>{i + 1}.</span>{s}
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

