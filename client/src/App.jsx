// client/src/App.jsx
import { useState, useEffect } from 'react'
import { supabase }    from './supabaseClient'
import AuthPage        from './pages/AuthPage'
import LevelSelect     from './pages/LevelSelect'
import Sidebar         from './components/Sidebar'
import Dashboard       from './components/Dashboard'
import Tasks           from './components/Tasks'

// ── Profile completion screen ────────────────────────────────
// Shown when an auth account exists but no student record was
// created (happens when email confirmation is enabled and the
// insert runs before the session is active).
function CompleteProfile({ authId, email, onDone }) {
  const [name,    setName]    = useState('')
  const [team,    setTeam]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function save() {
    if (!name.trim()) { setError('Please enter your name'); return }
    setLoading(true); setError(null)
    const { data, error: dbErr } = await supabase
      .from('students')
      .insert({ auth_id: authId, name: name.trim(), team: team.trim() || null, email })
      .select()
      .single()
    if (dbErr) { setError(dbErr.message); setLoading(false); return }
    onDone(data)
  }

  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
      <div className='bg-white rounded-2xl border border-gray-200 p-8 w-full max-w-sm'>
        <span className='bg-green-600 text-white text-xs font-bold px-2 py-1 rounded'>SPIKE</span>
        <h1 className='text-xl font-semibold text-gray-900 mt-3 mb-1'>Complete your profile</h1>
        <p className='text-sm text-gray-500 mb-5'>Just two more details and you are in.</p>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder='Your name *'
          className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3
                     outline-none focus:border-green-500' />
        <input
          value={team} onChange={e => setTeam(e.target.value)}
          placeholder='Team name (optional)'
          className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4
                     outline-none focus:border-green-500' />
        {error && <p className='text-red-600 text-sm mb-3'>{error}</p>}
        <button
          onClick={save} disabled={!name.trim() || loading}
          className='w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium
                     hover:bg-green-700 disabled:opacity-50'>
          {loading ? 'Saving...' : 'Get started →'}
        </button>
      </div>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null)
  const [student, setStudent] = useState(null)
  const [ready,   setReady]   = useState(false)
  const [page,    setPage]    = useState('tasks')

  // Track auth_id + email separately so CompleteProfile can use them
  const [authInfo, setAuthInfo] = useState(null)

  useEffect(() => {
    // Check for an existing session on first load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadStudent(session.user.id, session.user.email)
      else setReady(true)
    })

    // Listen for login / logout / email confirmation events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        if (session) loadStudent(session.user.id, session.user.email)
        else { setStudent(null); setAuthInfo(null); setReady(true) }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function loadStudent(authId, email) {
    const { data } = await supabase
      .from('students')
      .select('*')
      .eq('auth_id', authId)
      .single()

    if (data) {
      setStudent(data)
    } else {
      // Auth account confirmed but student record missing —
      // store auth info so CompleteProfile can create the record
      setAuthInfo({ authId, email })
      setStudent(null)
    }
    setReady(true)
  }

  function handleLevelChosen(levelId) {
    setStudent(prev => ({ ...prev, selected_level: levelId }))
  }

  // ── Render logic ──────────────────────────────────────────

  // 1. Still checking session
  if (!ready) return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
      <p className='text-sm text-gray-400'>Loading...</p>
    </div>
  )

  // 2. Not logged in → login / signup screen
  if (!session) return <AuthPage />

  // 3. Logged in but student record missing → profile completion
  if (!student && authInfo) return (
    <CompleteProfile
      authId={authInfo.authId}
      email={authInfo.email}
      onDone={setStudent}
    />
  )

  // 4. Student record exists but no level chosen → level picker
  if (student && !student.selected_level) return (
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
