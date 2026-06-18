// client/src/App.jsx
import { useState, useEffect } from 'react'
import { supabase }    from './supabaseClient'
import AuthPage        from './pages/AuthPage'
import LevelSelect     from './pages/LevelSelect'
import Sidebar         from './components/Sidebar'
import Dashboard       from './components/Dashboard'
import Tasks           from './components/Tasks'

export default function App() {
  const [session, setSession] = useState(null)
  const [student, setStudent] = useState(null)
  const [ready,   setReady]   = useState(false)
  const [page,    setPage]    = useState('tasks')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadStudent(session.user.id)
      else setReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_e, session) => {
        setSession(session)
        if (session) loadStudent(session.user.id)
        else { setStudent(null); setReady(true) }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function loadStudent(authId) {
    const { data } = await supabase.from('students')
      .select('*').eq('auth_id', authId).single()
    setStudent(data)
    setReady(true)
  }

  // Show nothing while checking login state
  if (!ready) return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
      <p className='text-gray-400 text-sm'>Loading...</p>
    </div>
  )

  // Not logged in → show login / signup screen
  if (!session) return <AuthPage />

  // Logged in but no level chosen → show level picker
  if (!student)
    return <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
    <p className='text-sm text-gray-400'>Setting up your account...</p>
    </div>

  if (!student.selected_level)
    return <LevelSelect student={student}
           onSelect={lv => setStudent({ ...student, selected_level: lv })} />
  // Fully logged in → show the main app
  return (
    <div className='flex h-screen bg-gray-50'>
      <Sidebar currentPage={page} onNavigate={setPage} student={student}
        onLogout={() => supabase.auth.signOut()} />
      <main className='flex-1 overflow-y-auto p-8'>
        {page === 'tasks'     && <Tasks student={student} />}
        {page === 'dashboard' && <Dashboard student={student} />}
      </main>
    </div>
  )
}
