import { Routes, Route, Navigate } from 'react-router-dom';
import AppHeader from './components/AppHeader.jsx';
import RoomLayout from './components/RoomLayout.jsx';
import RoomList from './pages/RoomList.jsx';
import RoomOverview from './pages/RoomOverview.jsx';
import Puzzles from './pages/Puzzles.jsx';
import Props from './pages/Props.jsx';
import Layout from './pages/Layout.jsx';
import Tasks from './pages/Tasks.jsx';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/rooms" replace />} />
          <Route path="/rooms" element={<RoomList />} />
          <Route path="/rooms/:roomId" element={<RoomLayout />}>
            <Route index element={<RoomOverview />} />
            <Route path="puzzles" element={<Puzzles />} />
            <Route path="props" element={<Props />} />
            <Route path="layout" element={<Layout />} />
            <Route path="tasks" element={<Tasks />} />
          </Route>
          <Route path="*" element={<Navigate to="/rooms" replace />} />
        </Routes>
      </main>
    </div>
  );
}
