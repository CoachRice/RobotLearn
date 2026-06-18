// client/src/App.jsx
import { useState, useEffect } from 'react'
import { supabase }    from './supabaseClient'
import AuthPage        from './pages/AuthPage'
import LevelSelect     from './pages/LevelSelect'
import Sidebar         from './components/Sidebar'
import Dashboard       from './components/Dashboard'
import Tasks           from './components/Tasks'

function Loading() {
  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
      <p className='text-sm text-gray-400'>Loading...</p>
    </div>
  )
}

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
      (_event, session) => {
        setSession(session)
        if (session) loadStudent(session.user.id)
        else { setStudent(null); setReady(true) }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function loadStudent(authId) {
    const { data } = await supabase
      .from('students')
      .select('*')
      .eq('auth_id', authId)
      .single()

    if (data) {
      setStudent(data)
    } else {
      // No student record found — sign out and return to login screen
      await supabase.auth.signOut()
    }
    setReady(true)
  }

  function handleLevelChosen(levelId) {
    setStudent(prev => ({ ...prev, selected_level: levelId }))
  }

  // 1. Still checking session or loading student record
  if (!ready) return <Loading />

  // 2. Not logged in → login / signup screen
  if (!session) return <AuthPage />

  // 3. Session exists but student record not loaded yet
  //    (prevents LevelSelect crashing when student is null)
  if (!student) return <Loading />

  // 4. Logged in but no level chosen → level picker
  if (!student.selected_level) return (
    <LevelSelect student={student} onSelect={handleLevelChosen} />
  )

  // 5. Fully set up → main app
  return (
    <div className='flex h-screen bg-gray-50'>
      <Sidebar
        currentPage={page}
        onNavigate={setPage}
        student={student}
        onLogout={() => supabase.auth.signOut()}
      />
      <main className='flex-1 overflow-y-auto p-8'>
        {page === 'tasks'     && <Tasks student={student} />}
        {page === 'dashboard' && <Dashboard student={student} />}
      </main>
    </div>
  )
}