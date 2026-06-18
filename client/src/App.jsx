// client/src/pages/AuthPage.jsx
import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function AuthPage() {
  const [mode,    setMode]    = useState('login')  // 'login' or 'signup'
  const [email,   setEmail]   = useState('')
  const [password, setPass]   = useState('')
  const [name,    setName]    = useState('')
  const [team,    setTeam]    = useState('')
  const [error,   setError]   = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password')
      return
    }
    setLoading(true)
    setError(null)

    const { data, error: authErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (authErr) {
      // Wrong email or password — show error and stop
      setError('Incorrect email or password. Please try again.')
      setLoading(false)
      return
    }

    if (!data?.session) {
      // No session returned even without an error — something unexpected
      setError('Could not sign in. Please try again.')
      setLoading(false)
      return
    }

    // Success — onAuthStateChange in App.jsx will handle the redirect
    setLoading(false)
  }

  async function handleSignup() {
    if (!name.trim()) {
      setError('Please enter your name')
      return
    }
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    setError(null)

    // Step 1: create the Supabase auth user
    const { data, error: authErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })

    if (authErr) {
      setError(authErr.message)
      setLoading(false)
      return
    }

    // Step 2: create the student record linked to the auth user
    const { error: dbErr } = await supabase.from('students').insert({
      auth_id: data.user.id,
      name:    name.trim(),
      team:    team.trim() || null,
      email:   email.trim(),
    })

    if (dbErr) {
      setError(dbErr.message)
      setLoading(false)
      return
    }

    // Success — onAuthStateChange in App.jsx will handle the redirect
    setLoading(false)
  }

  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
      <div className='bg-white rounded-2xl border border-gray-200 p-8 w-full max-w-sm'>

        {/* Logo */}
        <span className='bg-green-600 text-white text-xs font-bold px-2 py-1 rounded'>
          SPIKE
        </span>
        <h1 className='text-xl font-semibold text-gray-900 mt-2 mb-1'>RobotLearn</h1>
        <p className='text-sm text-gray-500 mb-5'>
          {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
        </p>

        {/* Signup-only fields */}
        {mode === 'signup' && (
          <>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder='Your name *'
              className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3
                         outline-none focus:border-green-500' />
            <input
              value={team} onChange={e => setTeam(e.target.value)}
              placeholder='Team name (optional)'
              className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3
                         outline-none focus:border-green-500' />
          </>
        )}

        {/* Email and password */}
        <input
          type='email'
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder='Email address'
          className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3
                     outline-none focus:border-green-500' />
        <input
          type='password'
          value={password} onChange={e => setPass(e.target.value)}
          placeholder='Password (min 6 characters)'
          className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4
                     outline-none focus:border-green-500' />

        {/* Error message */}
        {error && (
          <div className='bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3'>
            <p className='text-red-600 text-sm'>{error}</p>
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={mode === 'login' ? handleLogin : handleSignup}
          disabled={loading}
          className='w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium
                     hover:bg-green-700 disabled:opacity-50 mb-3'>
          {loading
            ? 'Please wait...'
            : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        {/* Toggle login / signup */}
        <button
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null) }}
          className='w-full text-sm text-gray-500 hover:text-gray-700'>
          {mode === 'login'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Sign in'}
        </button>

      </div>
    </div>
  )
}
