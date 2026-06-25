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
});
