import { mergeNewerLiveState } from "./liveState";

const state = (updatedAt, extras = {}) => ({ sessionId: "stress-test", updatedAt, ...extras });

describe("live presentation state ordering", () => {
  it("keeps presentation and more than five player devices from moving backward on stale packets", () => {
    const lobby = state("2026-06-24T18:00:00.000Z", { mode: "qr", gameStarted: false, currentIndex: 0 });
    const intro = state("2026-06-24T18:00:01.000Z", { mode: "categories", gameStarted: true, currentIndex: 0 });
    const question = state("2026-06-24T18:00:02.000Z", { mode: "question", gameStarted: true, currentIndex: 0, showAnswer: false });
    const answer = state("2026-06-24T18:00:03.000Z", { mode: "question", gameStarted: true, currentIndex: 0, showAnswer: true });
    const packetOrder = [lobby, intro, question, lobby, intro, question, answer, question, intro, lobby];

    const presentation = packetOrder.reduce((current, packet) => mergeNewerLiveState(current, packet), {});
    expect(presentation).toMatchObject({ mode: "question", gameStarted: true, showAnswer: true });

    const players = Array.from({ length: 8 }, (_, index) => {
      const shift = index % 4;
      const shiftedPackets = [...packetOrder.slice(shift), ...packetOrder.slice(0, shift)];
      return shiftedPackets.reduce((current, packet) => mergeNewerLiveState(current, packet), {});
    });

    expect(players).toHaveLength(8);
    players.forEach((playerState) => {
      expect(playerState).toMatchObject({ mode: "question", gameStarted: true, showAnswer: true });
    });
  });

  it("ignores equal timestamp heartbeat packets", () => {
    const current = state("2026-06-24T18:00:04.000Z", { mode: "question", showAnswer: true });
    const heartbeat = state("2026-06-24T18:00:04.000Z", { mode: "qr", showAnswer: false });

    expect(mergeNewerLiveState(current, heartbeat)).toBe(current);
  });

  it("uses live sequence to release a bonus question even when timestamps match", () => {
    const timestamp = "2026-06-24T18:00:05.000Z";
    const bonusPause = state(timestamp, { liveSequence: 41, mode: "bonus_pause", currentIndex: 9, pendingBonusIndex: 9 });
    const bonusQuestion = state(timestamp, { liveSequence: 42, mode: "question", currentIndex: 9, pendingBonusIndex: null, currentQuestion: { questionText: "Name this founding Father." } });

    expect(mergeNewerLiveState(bonusPause, bonusQuestion)).toMatchObject({
      liveSequence: 42,
      mode: "question",
      pendingBonusIndex: null,
      currentQuestion: { questionText: "Name this founding Father." },
    });
  });

  it("allows a newer host reload state even if its sequence restarted lower", () => {
    const oldPause = state("2026-06-24T18:00:05.000Z", { liveSequence: 42, mode: "bonus_pause", currentIndex: 9, pendingBonusIndex: 9 });
    const reloadedHostQuestion = state("2026-06-24T18:01:05.000Z", { liveSequence: 1, mode: "question", currentIndex: 9, pendingBonusIndex: null, currentQuestion: { questionText: "Name this founding Father." } });

    expect(mergeNewerLiveState(oldPause, reloadedHostQuestion)).toMatchObject({
      liveSequence: 1,
      mode: "question",
      pendingBonusIndex: null,
    });
  });
});
