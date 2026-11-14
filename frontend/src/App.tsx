import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Skeleton } from './components/ui'

const screens = {
  Main: lazy(() => import('./screens/Main')),
  MicCheck: lazy(() => import('./screens/MicCheck')),
  Record: lazy(() => import('./screens/Record')),
  Analyzing: lazy(() => import('./screens/Analyzing')),
  Profile: lazy(() => import('./screens/Profile')),
  Home: lazy(() => import('./screens/Home')),
  Exercise: lazy(() => import('./screens/Exercise')),
  Done: lazy(() => import('./screens/Done')),
  Progress: lazy(() => import('./screens/Progress')),
  CheckIn: lazy(() => import('./screens/CheckIn')),
  Settings: lazy(() => import('./screens/Settings')),
}

export default function App() {
  const S = screens
  return (
    <Suspense fallback={<Skeleton height={240} />}>
      <Routes>
        <Route path="/" element={<S.Main />} />
        <Route path="/mic-check" element={<S.MicCheck />} />
        <Route path="/record" element={<S.Record />} />
        <Route path="/analyzing" element={<S.Analyzing />} />
        <Route path="/profile/:assessmentId" element={<S.Profile />} />
        <Route path="/today" element={<S.Home />} />
        <Route path="/exercise/:planItemId" element={<S.Exercise />} />
        <Route path="/done/:lessonId" element={<S.Done />} />
        <Route path="/progress" element={<S.Progress />} />
        <Route path="/check-in" element={<S.CheckIn />} />
        <Route path="/settings" element={<S.Settings />} />
        <Route path="*" element={<S.Main />} />
      </Routes>
    </Suspense>
  )
}
