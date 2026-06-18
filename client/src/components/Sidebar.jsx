// client/src/components/Sidebar.jsx
const navItems = [
  { id:'tasks',     label:'Learning path', icon:'📍' },
  { id:'dashboard', label:'Dashboard',     icon:'🏠' },
]

export default function Sidebar({ currentPage, onNavigate, student, onLogout }) {
  const lvLabel = student?.selected_level === 1
    ? 'Level 1 — Navigator' : 'Level 2 — Sensor Pro'
  const lvColor = student?.selected_level === 1
    ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'
  return (
    <aside className='w-52 bg-white border-r border-gray-200 flex flex-col py-4'>
      <div className='px-5 mb-5'>
        <span className='bg-green-600 text-white text-xs font-bold px-2 py-1 rounded'>SPIKE</span>
        <p className='text-sm font-semibold text-gray-800 mt-2'>RobotLearn</p>
        <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${lvColor}`}>
          {lvLabel}
        </span>
      </div>
      <nav className='flex-1 px-3'>
        {navItems.map(item => (
          <button key={item.id} onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-1
              ${currentPage===item.id
                ? 'bg-green-50 text-green-700 font-medium'
                : 'text-gray-600 hover:bg-gray-50'}`}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className='px-5 pt-3 border-t border-gray-100'>
        <p className='text-sm font-medium text-gray-800'>{student?.name}</p>
        <p className='text-xs text-gray-400 mb-2'>{student?.team || 'No team'}</p>
        <button onClick={onLogout} className='text-xs text-gray-400 hover:text-red-500'>
          Sign out
        </button>
      </div>
    </aside>
  )
}
