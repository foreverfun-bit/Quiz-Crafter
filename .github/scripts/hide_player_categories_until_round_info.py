from pathlib import Path

path = Path('frontend/src/pages/PlayerSession.jsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        'return <JoinScreen name={name} setName={setName} joinGame={joinGame} sessionName={sessionName} roundCategories={roundCategories} branding={branding} updatePreference={updatePreference} setUpdatePreference={setUpdatePreference} updateContact={updateContact} setUpdateContact={setUpdateContact} />;',
        'return <JoinScreen name={name} setName={setName} joinGame={joinGame} sessionName={sessionName} branding={branding} updatePreference={updatePreference} setUpdatePreference={setUpdatePreference} updateContact={updateContact} setUpdateContact={setUpdateContact} />;',
    ),
    (
        '{!gameStarted && <PlayerLobby sessionName={sessionName} connected={connected} roundCategories={roundCategories} branding={branding} />}',
        '{!gameStarted && <PlayerLobby sessionName={sessionName} connected={connected} branding={branding} />}',
    ),
    (
        'const JoinScreen = ({ name, setName, joinGame, sessionName, roundCategories, branding, updatePreference, setUpdatePreference, updateContact, setUpdateContact }) => (',
        'const JoinScreen = ({ name, setName, joinGame, sessionName, branding, updatePreference, setUpdatePreference, updateContact, setUpdateContact }) => (',
    ),
    (
        '      <RoundCategoryCard roundCategories={roundCategories} compact />\n',
        '',
    ),
    (
        'const PlayerLobby = ({ sessionName, connected, roundCategories, branding }) => (',
        'const PlayerLobby = ({ sessionName, connected, branding }) => (',
    ),
    (
        '    <RoundCategoryCard roundCategories={roundCategories} />\n',
        '',
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Missing expected text: {old[:80]}')
    text = text.replace(old, new, 1)

start = text.find('const RoundCategoryCard = ({ roundCategories, compact = false }) => (')
end = text.find('\nconst RoundIntroFeedback =', start)
if start == -1 or end == -1:
    raise SystemExit('Could not find RoundCategoryCard block')
text = text[:start] + text[end + 1:]

path.write_text(text, encoding='utf-8')
print('Hidden round categories from player join and lobby screens.')
