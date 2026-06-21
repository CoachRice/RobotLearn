// client/src/components/Dashboard.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

export default function Dashboard({ student }) {
  const [stats, setStats] = useState({
    modulesDone:    0,
    totalModules:   0,
    tasksSubmitted: 0,
    bestScore:      null,   // null = no submissions yet
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!student?.id) return

    async function loadStats() {
      setLoading(true)

      // ── Modules done — completed topics within the student's own level ──
      const [{ data: levelModules }, { data: progressRows }] = await Promise.all([
        supabase
          .from('modules')
          .select('slug')
          .eq('level', student.selected_level),
        supabase
          .from('progress')
          .select('module_slug, status')
          .eq('student_id', student.id),
      ])

      const levelSlugs  = new Set((levelModules || []).map(m => m.slug))
      const modulesDone = (progressRows || [])
        .filter(p => p.status === 'complete' && levelSlugs.has(p.module_slug))
        .length

      // ── Tasks submitted + Best score — from the submissions table ──
      const { data: submissionRows } = await supabase
        .from('submissions')
        .select('score')
        .eq('student_id', student.id)

      const tasksSubmitted = submissionRows?.length || 0
      const bestScore = tasksSubmitted > 0
        ? Math.max(...submissionRows.map(s => s.score ?? 0))
        : null

      setStats({
        modulesDone,
        totalModules: levelSlugs.size,
        tasksSubmitted,
        bestScore,
      })
      setLoading(false)
    }

    loadStats()
  }, [student?.id, student?.selected_level])

  const cards = [
    {
      label: 'Modules done',
      value: loading ? '—' : `${stats.modulesDone} / ${stats.totalModules}`,
    },
    {
      label: 'Tasks submitted',
      value: loading ? '—' : String(stats.tasksSubmitted),
    },
    {
      label: 'Best score',
      value: loading ? '—' : (stats.bestScore === null ? '—' : String(stats.bestScore)),
    },
  ]

  return (
    <div>
      <h1 className='text-2xl font-semibold text-gray-800 mb-6'>Dashboard</h1>

      <div className='grid grid-cols-3 gap-4 mb-6'>
        {cards.map(c => (
          <div key={c.label} className='bg-white rounded-xl border border-gray-200 p-5'>
            <p className='text-xs text-gray-500 mb-1'>{c.label}</p>
            <p className='text-3xl font-semibold text-gray-800'>{c.value}</p>
          </div>
        ))}
      </div>

      <div className='bg-green-50 border border-green-200 rounded-xl p-5'>
        <h2 className='font-semibold text-green-800 mb-1'>
          Welcome back, {student?.name}!
        </h2>
        <p className='text-sm text-green-700'>
          Continue where you left off on the Learning path.
        </p>
      </div>
    </div>
  )
}