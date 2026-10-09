import { createHashRouter, Navigate, useParams } from 'react-router-dom';
import { App } from './App';
import { useSettingsStore } from './state/settingsStore';
import { LearnScreen } from './screens/learn/LearnScreen';
import { LessonScreen } from './screens/learn/LessonScreen';
import { DailyScreen } from './screens/daily/DailyScreen';
import { PractiseScreen } from './screens/practise/PractiseScreen';
import { SetupScreen } from './screens/practise/SetupScreen';
import { ExploreScreen } from './screens/explore/ExploreScreen';
import { ProgressScreen } from './screens/progress/ProgressScreen';
import { AttemptDetailScreen } from './screens/progress/AttemptDetailScreen';
import { DevicesScreen } from './screens/devices/DevicesScreen';
import { DataScreen } from './screens/data/DataScreen';
import { SessionScreen } from './screens/session/SessionScreen';
import { RouteError } from './components/RouteError';

/** Remount setup per family so one family's parameters never leak into another. */
function SetupRoute() {
  const { familyId } = useParams();
  return <SetupScreen key={familyId} />;
}

function StartTab() {
  const start = useSettingsStore((s) => s.settings.startTab);
  return <Navigate to={start === 'daily' ? '/daily' : '/learn'} replace />;
}

// Hash routing keeps the app servable from any static file host (GitHub Pages).
export const router = createHashRouter([
  { path: '/session', element: <SessionScreen />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <StartTab /> },
      { path: 'learn', element: <LearnScreen /> },
      { path: 'learn/:lessonId', element: <LessonScreen /> },
      { path: 'daily', element: <DailyScreen /> },
      { path: 'practise', element: <PractiseScreen /> },
      { path: 'practise/:familyId', element: <SetupRoute /> },
      { path: 'explore', element: <ExploreScreen /> },
      { path: 'progress', element: <ProgressScreen /> },
      { path: 'progress/:attemptId', element: <AttemptDetailScreen /> },
      { path: 'devices', element: <DevicesScreen /> },
      { path: 'data', element: <DataScreen /> },
      { path: '*', element: <StartTab /> },
    ],
  },
]);
