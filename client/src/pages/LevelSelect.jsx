// client/src/pages/LevelSelect.jsx
import { supabase } from '../supabaseClient'

const LEVELS = [
  { id:1, name:'Level 1 — Navigator', icon:'🧩',
    desc:'Build programs visually with Blockly. Paste the generated Python into RobotLearn for AI review.',
    topics:['Build your robot','Hello robot','Drive straight','Turn and navigate'],
    ring:'border-green-500' },
  { id:2, name:'Level 2 — Sensor Pro', icon:'🐍',
    desc:'Continue here after finishing Level 1.',
    topics:['Sensor introductions','Force sensor','Distance sensor','Colour sensor','IMU'],
    ring:'border-purple-500' },
]

export default function LevelSelect({ student, onSelect }) {
  async function choose(levelId) {
    await supabase.from('students')
      .update({ selected_level: levelId })
      .eq('id', student.id)
    onSelect(levelId)
  }
  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center p-6'>
      <div className='max-w-2xl w-full'>
        <h1 className='text-2xl font-semibold text-gray-900 mb-1'>
          Welcome, {student.name}!
        </h1>
        <p className='text-gray-500 mb-8'>Choose your learning level to get started.</p>
        <div className='grid grid-cols-2 gap-5'>
          {LEVELS.map(lv => (
            <div key={lv.id} onClick={()=>choose(lv.id)}
              className={`bg-white rounded-2xl border-2 ${lv.ring} p-6 cursor-pointer
                          hover:shadow-sm transition-shadow`}>
              <div className='text-3xl mb-3'>{lv.icon}</div>
              <h2 className='font-semibold text-gray-900 mb-1'>{lv.name}</h2>
              <p className='text-sm text-gray-500 mb-4'>{lv.desc}</p>
              <div className='space-y-1'>
                {lv.topics.map((t,i) => (
                  <div key={i} className='flex items-center gap-2 text-sm text-gray-600'>
                    <span className='text-xs text-gray-400'>{i+1}</span>{t}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
