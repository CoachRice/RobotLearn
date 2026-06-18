// client/src/components/Dashboard.jsx
export default function Dashboard({ student }) {
  return (
    <div>
      <h1 className='text-2xl font-semibold text-gray-800 mb-6'>Dashboard</h1>
      <div className='grid grid-cols-3 gap-4 mb-6'>
        {[{label:'Modules done',value:'2 / 4'},{label:'Tasks submitted',value:'1'},
           {label:'Best score',value:'82'}].map(c=>(
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
