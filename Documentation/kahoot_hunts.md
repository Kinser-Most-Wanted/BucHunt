# Kahoot Hunts

Select **Kahoot Hunt** in Create a Hunt. Traditional Hunt is the default and existing hunts keep their original behavior. Add trivia or multiple-choice tasks using the existing task editor. Timers are optional, from 1 to 3600 seconds. Blank means no time limit.

Players sign in and join using the hunt access code, then wait in a lobby. Owners and Officers open the hunt overview to see joined players, connection status, and the host dashboard. **Start hunt** releases the first question to every participant. The host controls the start regardless of the scheduled start time. New participants cannot join once a Kahoot Hunt has started. Existing active participants can refresh or reconnect using the same Google account.

Each player gets one submission per question, including incorrect answers. The server rejects submissions for previous or unreleased questions and after a deadline. The question ends when every active participant has answered, its optional timer expires, or the host selects **End question**. Between questions, the host selects **Next question**. The final question ends the hunt automatically. **End hunt** finishes early. An untimed question with disconnected players can be ended by its host.

The leaderboard ranks by total score. Correct answers receive the task's configured points, or 1000 when points are zero. The score is rounded from `base × (1 − 0.5 × min(1, elapsed / window))`, using server receipt time. The window is the question timer, or 60 seconds for untimed questions. Faster answers earn more points; wrong or unanswered questions earn zero. Display names come from existing player profiles.

Questions are frozen when the host starts. Task editing is blocked after starting to keep task IDs and scoring consistent. Create another hunt to run another game. Each game can be started once.

## Synchronization and storage

Clients poll the server every second while viewing a Kahoot Hunt. Question IDs, phases, deadlines, submissions, scores, and the frozen question list persist in `kahoot-games.json` under `DATA_DIRECTORY`. Browser refresh and server restart restore the current question and do not restart its clock. A deadline that elapsed while the server was stopped is applied on the next state read. A late answer is rejected even before another client has polled. Correct task completions also mirror into the existing participation store for exports; the game store remains authoritative and repairs missing mirrors on reconnect.

This uses BucHunt's existing single server process and atomic JSON file writes. It requires no new dependencies or deployment configuration. State transitions and submissions are serialized. Connection status means a player has polled within the last 15 seconds, so it is an indication rather than a guarantee of an open connection. Only the current released question is sent to players; required answers stay on the server. Issue reports can refer to released questions or the hunt in general.
