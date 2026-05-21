from pathlib import Path

path = Path('frontend/src/pages/HostSession.jsx')
text = path.read_text(encoding='utf-8')

replacements = [
    ('  const [presentMode, setPresentMode] = useState("question");\n', '  const [presentMode, setPresentMode] = useState("question");\n  const [gameStarted, setGameStarted] = useState(false);\n'),
    ('  const startTimer = () => setTimerEndAt(Date.now() + Math.max(1, Number(timerSeconds) || 30) * 1000);\n', '  const releaseMode = (mode) => {\n    setPresentMode(mode);\n    setGameStarted(true);\n  };\n\n  const toggleAnswer = () => {\n    setShowAnswer((value) => !value);\n    setGameStarted(true);\n    setPresentMode("question");\n  };\n\n  const toggleFunFact = () => {\n    setShowFunFact((value) => !value);\n    setGameStarted(true);\n    setPresentMode("question");\n  };\n\n  const startTimer = () => {\n    setTimerEndAt(Date.now() + Math.max(1, Number(timerSeconds) || 30) * 1000);\n    setGameStarted(true);\n    setPresentMode("question");\n  };\n'),
    ('    setPresentMode("question");\n  };\n\n  const startTimer', '    releaseMode("question");\n  };\n\n  const startTimer'),
    ('      mode: presentMode,\n', '      mode: presentMode,\n      gameStarted,\n      joinUrl,\n'),
    ('  }, [id, session, sessionName, questions.length, currentQuestion, currentIndex, showAnswer, showFunFact, presentMode, leaderboard, players, pointsPerQuestion, wagerMode, timerEndAt, timeRemaining, acceptingAnswers]);\n', '  }, [id, session, sessionName, questions.length, currentQuestion, currentIndex, showAnswer, showFunFact, presentMode, gameStarted, joinUrl, leaderboard, players, pointsPerQuestion, wagerMode, timerEndAt, timeRemaining, acceptingAnswers]);\n'),
    ('          {!focusMode && <PresentationControls mode={presentMode} setMode={setPresentMode} showAnswer={showAnswer} setShowAnswer={setShowAnswer} showFunFact={showFunFact} setShowFunFact={setShowFunFact} hasFunFact={Boolean(currentQuestion.funFact)} />}\n', '          {!focusMode && <PresentationControls mode={presentMode} setMode={releaseMode} showAnswer={showAnswer} toggleAnswer={toggleAnswer} showFunFact={showFunFact} toggleFunFact={toggleFunFact} hasFunFact={Boolean(currentQuestion.funFact)} />}\n'),
    ('<Button onClick={() => setShowAnswer((value) => !value)} className={showAnswer ? "bg-zinc-800 text-white hover:bg-zinc-700" : "gradient-btn"}>', '<Button onClick={toggleAnswer} className={showAnswer ? "bg-zinc-800 text-white hover:bg-zinc-700" : "gradient-btn"}>'),
    ('<Button onClick={() => setShowFunFact((value) => !value)} disabled={!currentQuestion.funFact} className="bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50">', '<Button onClick={toggleFunFact} disabled={!currentQuestion.funFact} className="bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50">'),
    ('<PhonePlayPanel joinUrl={joinUrl} copyJoinLink={copyJoinLink} players={players} answers={currentAnswers} adjustScore={adjustScore} pointsPerQuestion={Number(pointsPerQuestion) || getDefaultPoints(currentQuestion)} wagerMode={wagerMode} setMode={setPresentMode} />', '<PhonePlayPanel joinUrl={joinUrl} copyJoinLink={copyJoinLink} players={players} answers={currentAnswers} adjustScore={adjustScore} pointsPerQuestion={Number(pointsPerQuestion) || getDefaultPoints(currentQuestion)} wagerMode={wagerMode} setMode={releaseMode} />'),
    ('showLeaderboard={() => setPresentMode("leaderboard")}', 'showLeaderboard={() => releaseMode("leaderboard")}'),
    ('    setPresentMode("leaderboard");\n  };\n', '    releaseMode("leaderboard");\n  };\n'),
    ('const PresentationControls = ({ mode, setMode, showAnswer, setShowAnswer, showFunFact, setShowFunFact, hasFunFact }) =>', 'const PresentationControls = ({ mode, setMode, showAnswer, toggleAnswer, showFunFact, toggleFunFact, hasFunFact }) =>'),
    ('onClick={() => setShowAnswer((value) => !value)}', 'onClick={toggleAnswer}'),
    ('onClick={() => setShowFunFact((value) => !value)}', 'onClick={toggleFunFact}'),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Missing expected text: {old[:120]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Host release buttons now mark the game as started and broadcast the selected mode.')
