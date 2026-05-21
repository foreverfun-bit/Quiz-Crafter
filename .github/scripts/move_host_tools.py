from pathlib import Path

# Wire route in App.js
app = Path('frontend/src/App.js')
text = app.read_text(encoding='utf-8')
if 'import HostTools from "./pages/HostTools";' not in text:
    text = text.replace('import PlayerView from "./pages/PlayerView";\n', 'import PlayerView from "./pages/PlayerView";\nimport HostTools from "./pages/HostTools";\n')
if '<Route path="/host-tools"' not in text:
    text = text.replace('            <Route path="/game-history" element={<ProtectedRoute><AppLayout><GameHistory /></AppLayout></ProtectedRoute>} />\n', '            <Route path="/game-history" element={<ProtectedRoute><AppLayout><GameHistory /></AppLayout></ProtectedRoute>} />\n            <Route path="/host-tools" element={<ProtectedRoute><AppLayout><HostTools /></AppLayout></ProtectedRoute>} />\n')
app.write_text(text, encoding='utf-8')

# Add sidebar nav
sidebar = Path('frontend/src/components/Sidebar.jsx')
text = sidebar.read_text(encoding='utf-8')
if '  Megaphone,\n' not in text:
    text = text.replace('  Trophy,\n', '  Trophy,\n  Megaphone,\n')
if 'label: "Host Tools"' not in text:
    text = text.replace('    { path: "/game-history", icon: Trophy, label: "Game History" },\n', '    { path: "/game-history", icon: Trophy, label: "Game History" },\n    { path: "/host-tools", icon: Megaphone, label: "Host Tools" },\n')
sidebar.write_text(text, encoding='utf-8')

# Remove updates/feedback panels from host screen
host = Path('frontend/src/pages/HostSession.jsx')
text = host.read_text(encoding='utf-8')
text = text.replace('  Mail,\n', '')
text = text.replace('  const [hostUpdateMessage, setHostUpdateMessage] = useState("");\n', '')
text = text.replace('  const [feedback, setFeedback] = useState([]);\n', '')
text = text.replace('  const [categoryFeedback, setCategoryFeedback] = useState([]);\n', '')
text = text.replace('''      .on("broadcast", { event: "feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || payload.questionIndex === undefined) return;
        setFeedback((current) => {
          const filtered = current.filter((item) => !(item.playerId === payload.playerId && item.questionIndex === payload.questionIndex));
          return [...filtered, payload];
        });
      })
      .on("broadcast", { event: "category_feedback_submit" }, ({ payload }) => {
        if (!payload?.playerId || !payload.category) return;
        setCategoryFeedback((current) => {
          const filtered = current.filter((item) => !(item.playerId === payload.playerId && item.category === payload.category && item.roundName === payload.roundName));
          return [...filtered, payload];
        });
      })
''', '')
text = text.replace('''
  const sendHostUpdate = async () => {
    const message = hostUpdateMessage.trim();
    if (!message) return toast.error("Write an update first");
    liveChannelRef.current?.send({ type: "broadcast", event: "host_update", payload: { message, sentAt: new Date().toISOString() } });
    setHostUpdateMessage("");
    toast.success("Update sent to connected players");
  };
''', '\n')
text = text.replace('<HostUpdatesPanel players={players} message={hostUpdateMessage} setMessage={setHostUpdateMessage} sendUpdate={sendHostUpdate} /><HostFeedbackPanel feedback={feedback} categoryFeedback={categoryFeedback} currentIndex={currentIndex} currentQuestion={currentQuestion} />', '')
start = text.find('const HostUpdatesPanel = ({ players, message, setMessage, sendUpdate }) => {')
end = text.find('\nconst LeaderboardPanel =', start)
if start != -1 and end != -1:
    text = text[:start] + text[end + 1:]
else:
    raise SystemExit('Could not remove host updates/feedback panels')
text = text.replace('\nconst SendIconLabel = () => <><MessageSquare size={15} className="mr-2" /></>;\n', '\n')
host.write_text(text, encoding='utf-8')
print('Host tools routed and removed from live host screen.')
